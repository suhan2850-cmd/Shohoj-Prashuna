import { Prisma, PrismaClient, UserRole, PaymentProvider, PaymentStatus, OrderStatus } from "@prisma/client";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = globalForPrisma.prisma ?? new PrismaClient({ log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"] });
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

const SESSION_COOKIE = "shohoj_session";
export class HttpError extends Error { constructor(public status: number, message: string, public details?: unknown) { super(message); } }
export type SessionUser = { id: string; name: string; email: string; role: UserRole };

function authSecret() {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is required");
  return new TextEncoder().encode(value);
}
export const hashPassword = (password: string) => bcrypt.hash(password, 12);
export const verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash);

export async function getSession(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, authSecret());
    const role = payload.role as UserRole;
    if (typeof payload.sub !== "string" || typeof payload.email !== "string" || !Object.values(UserRole).includes(role)) return null;
    return { id: payload.sub, name: typeof payload.name === "string" ? payload.name : "", email: payload.email, role };
  } catch { return null; }
}
export async function requireSession() { const s = await getSession(); if (!s) throw new HttpError(401, "Authentication required"); return s; }
export async function requireAdmin() { const s = await requireSession(); if (s.role !== UserRole.ADMIN) throw new HttpError(403, "Administrator access required"); return s; }

export async function setSession(response: NextResponse, user: SessionUser) {
  const token = await new SignJWT({ name: user.name, email: user.email, role: user.role }).setProtectedHeader({ alg: "HS256" }).setSubject(user.id).setIssuedAt().setExpirationTime("7d").sign(authSecret());
  response.cookies.set({ name: SESSION_COOKIE, value: token, httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 7 });
  return response;
}
export function clearSession(response: NextResponse) { response.cookies.set({ name: SESSION_COOKIE, value: "", httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 }); return response; }
export const moneyToCents = (value: unknown) => Math.round(Number(String(value)) * 100);
export const centsToMoney = (value: number) => (value / 100).toFixed(2);

export async function initializePayment(input: { provider: PaymentProvider; orderId: string; amount: string }) {
  if (input.provider === PaymentProvider.MANUAL) return { provider: input.provider, reference: input.orderId, checkoutUrl: null, message: "Manual payment mode. An administrator must mark this order as paid." };
  const required: Record<PaymentProvider, string[]> = {
    BKASH: ["BKASH_APP_KEY", "BKASH_APP_SECRET", "BKASH_USERNAME", "BKASH_PASSWORD"],
    NAGAD: ["NAGAD_MERCHANT_ID", "NAGAD_MERCHANT_NUMBER", "NAGAD_PUBLIC_KEY", "NAGAD_PRIVATE_KEY"],
    SSLCOMMERZ: ["SSLCOMMERZ_STORE_ID", "SSLCOMMERZ_STORE_PASSWORD"], MANUAL: []
  };
  const missing = required[input.provider].filter(k => !process.env[k]);
  if (missing.length) throw new HttpError(501, `${input.provider} is not configured`, { missing });
  throw new HttpError(501, `${input.provider} adapter is ready for integration but provider-specific initiation is not implemented`, { orderId: input.orderId, amount: input.amount });
}

export async function fulfillOrder(orderId: string) {
  return prisma.$transaction(async tx => {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order) throw new HttpError(404, "Order not found");
    if (order.paymentStatus === PaymentStatus.PAID) return order;
    for (const item of order.items) {
      if (item.productId) {
        const product = await tx.product.findUnique({ where: { id: item.productId } });
        if (!product || !product.isActive) throw new HttpError(409, "A product in this order is unavailable");
        if (product.stock !== null) {
          if (product.stock < item.quantity) throw new HttpError(409, `Insufficient stock for ${product.name}`);
          await tx.product.update({ where: { id: product.id }, data: { stock: { decrement: item.quantity } } });
        }
      }
      if (item.courseId) await tx.enrollment.upsert({ where: { userId_courseId: { userId: order.userId, courseId: item.courseId } }, create: { userId: order.userId, courseId: item.courseId }, update: { status: "ACTIVE" } });
    }
    return tx.order.update({ where: { id: order.id }, data: { status: OrderStatus.PAID, paymentStatus: PaymentStatus.PAID } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}