import { NextResponse } from "next/server";
import { Prisma, UserRole } from "@prisma/client";
import { z } from "zod";
import { HttpError, clearSession, getSession, hashPassword, prisma, requireAdmin, requireSession, setSession, verifyPassword } from "@/lib/server";

type Context = { params: Promise<{ path?: string[] }> };
const ok = (data: unknown, status = 200) => NextResponse.json(data, { status });
const registerSchema = z.object({ name: z.string().trim().min(2).max(100), email: z.string().email().transform(v => v.toLowerCase()), password: z.string().min(8).max(100), phone: z.string().min(6).max(30).optional() });
const loginSchema = z.object({ email: z.string().email().transform(v => v.toLowerCase()), password: z.string().min(1) });
const courseSchema = z.object({ title: z.string().min(2), slug: z.string().min(2), description: z.string().optional(), mode: z.enum(["LIVE", "RECORDED"]), price: z.coerce.number().min(0), published: z.boolean().default(false) });
const productSchema = z.object({ name: z.string().min(2), slug: z.string().min(2), description: z.string().optional(), type: z.enum(["BOOK", "DIGITAL"]), price: z.coerce.number().min(0), stock: z.number().int().min(0).nullable().optional() });

async function getPath(ctx: Context) { return (await ctx.params).path ?? []; }
function userView(u: any) { return { id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role }; }
function courseView(c: any) { return { id: c.id, title: c.title, slug: c.slug, description: c.description, mode: c.mode, price: c.price.toString(), published: c.published, lessonsCount: c._count?.lessons ?? 0 }; }
function productView(p: any) { return { id: p.id, name: p.name, slug: p.slug, description: p.description, type: p.type, price: p.price.toString(), stock: p.stock, isActive: p.isActive }; }
async function run(fn: () => Promise<NextResponse>) { try { return await fn(); } catch (e) { if (e instanceof HttpError) return ok({ error: e.message, details: e.details }, e.status); if (e instanceof z.ZodError) return ok({ error: "Validation failed", details: e.flatten() }, 400); if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return ok({ error: "A record with this unique value already exists" }, 409); console.error(e); return ok({ error: "Internal server error" }, 500); } }

async function handleGet(request: Request, ctx: Context) {
  const path = await getPath(ctx);
  if (path.length === 0 || path[0] === "health") return ok({ ok: true, service: "shohoj-porashuna-api", timestamp: new Date().toISOString() });
  if (path[0] === "me") { const s = await requireSession(); const u = await prisma.user.findUnique({ where: { id: s.id } }); if (!u) throw new HttpError(404, "User not found"); return ok({ user: userView(u) }); }
  if (path[0] === "courses" && path.length === 1) { const s = await getSession(); const where: Prisma.CourseWhereInput = s?.role === UserRole.ADMIN ? {} : { published: true }; const courses = await prisma.course.findMany({ where, include: { _count: { select: { lessons: true } } }, orderBy: { createdAt: "desc" } }); return ok({ data: courses.map(courseView) }); }
  if (path[0] === "courses" && path.length === 2) { const course = await prisma.course.findFirst({ where: { OR: [{ id: path[1] }, { slug: path[1] }] }, include: { lessons: { orderBy: { sortOrder: "asc" } }, _count: { select: { lessons: true } } } }); if (!course) throw new HttpError(404, "Course not found"); const s = await getSession(); if (!course.published && s?.role !== UserRole.ADMIN) throw new HttpError(404, "Course not found"); return ok({ course: courseView(course), lessons: course.lessons }); }
  if (path[0] === "products" && path.length === 1) { const products = await prisma.product.findMany({ where: { isActive: true }, orderBy: { createdAt: "desc" } }); return ok({ data: products.map(productView) }); }
  if (path[0] === "admin" && path[1] === "orders") { await requireAdmin(); const orders = await prisma.order.findMany({ include: { user: { select: { id: true, name: true, email: true, phone: true } }, items: true }, orderBy: { createdAt: "desc" }, take: 100 }); return ok({ data: orders }); }
  throw new HttpError(404, "Endpoint not found");
}

async function handlePost(request: Request, ctx: Context) {
  const path = await getPath(ctx);
  if (path[0] === "auth" && path[1] === "register") { const input = registerSchema.parse(await request.json()); if (await prisma.user.findUnique({ where: { email: input.email } })) throw new HttpError(409, "An account already exists for this email"); const user = await prisma.user.create({ data: { name: input.name, email: input.email, phone: input.phone, passwordHash: await hashPassword(input.password) } }); return setSession(ok({ user: userView(user) }, 201), { id: user.id, name: user.name, email: user.email, role: user.role }); }
  if (path[0] === "auth" && path[1] === "login") { const input = loginSchema.parse(await request.json()); const user = await prisma.user.findUnique({ where: { email: input.email } }); if (!user || !(await verifyPassword(input.password, user.passwordHash))) throw new HttpError(401, "Invalid email or password"); return setSession(ok({ user: userView(user) }), { id: user.id, name: user.name, email: user.email, role: user.role }); }
  if (path[0] === "auth" && path[1] === "logout") return clearSession(ok({ ok: true }));
  if (path[0] === "courses" && path.length === 3 && path[2] === "enroll") { const s = await requireSession(); const course = await prisma.course.findFirst({ where: { OR: [{ id: path[1] }, { slug: path[1] }], published: true } }); if (!course) throw new HttpError(404, "Course not found"); if (Number(course.price) > 0) throw new HttpError(402, "This course requires payment"); const enrollment = await prisma.enrollment.upsert({ where: { userId_courseId: { userId: s.id, courseId: course.id } }, create: { userId: s.id, courseId: course.id }, update: { status: "ACTIVE" } }); return ok({ enrollment }, 201); }
  if (path[0] === "admin" && path[1] === "courses") { await requireAdmin(); const input = courseSchema.parse(await request.json()); const course = await prisma.course.create({ data: input }); return ok({ course: courseView(course) }, 201); }
  if (path[0] === "admin" && path[1] === "products") { await requireAdmin(); const input = productSchema.parse(await request.json()); const product = await prisma.product.create({ data: { ...input, isActive: true } }); return ok({ product: productView(product) }, 201); }
  throw new HttpError(404, "Endpoint not found");
}

export async function GET(request: Request, ctx: Context) { return run(() => handleGet(request, ctx)); }
export async function POST(request: Request, ctx: Context) { return run(() => handlePost(request, ctx)); }
