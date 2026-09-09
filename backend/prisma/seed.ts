import { PrismaClient, CourseMode, ProductType, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
async function main() {
  const adminEmail = process.env.ADMIN_EMAIL ?? "admin@shohoj.local";
  const adminPassword = process.env.ADMIN_PASSWORD ?? "ChangeMe123!";
  await prisma.user.upsert({ where: { email: adminEmail }, update: { role: UserRole.ADMIN }, create: { name: "Shohoj Porashuna Admin", email: adminEmail, passwordHash: await bcrypt.hash(adminPassword, 12), role: UserRole.ADMIN } });
  const dept = await prisma.department.upsert({ where: { code: "CSE" }, update: { name: "Computer Science and Engineering" }, create: { code: "CSE", name: "Computer Science and Engineering" } });
  const semester = await prisma.semester.upsert({ where: { departmentId_number: { departmentId: dept.id, number: 1 } }, update: { label: "First Semester" }, create: { departmentId: dept.id, number: 1, label: "First Semester" } });
  const course = await prisma.course.upsert({ where: { slug: "programming-fundamentals" }, update: { published: true }, create: { title: "Programming Fundamentals", slug: "programming-fundamentals", description: "A foundation course covering programming logic and problem solving.", mode: CourseMode.RECORDED, price: "0.00", published: true, departmentId: dept.id, semesterId: semester.id } });
  await prisma.lesson.upsert({ where: { courseId_slug: { courseId: course.id, slug: "introduction" } }, update: {}, create: { courseId: course.id, title: "Introduction", slug: "introduction", description: "Course introduction and learning roadmap.", content: "Welcome to Programming Fundamentals.", sortOrder: 1, durationMin: 12, isPreview: true } });
  await prisma.lesson.upsert({ where: { courseId_slug: { courseId: course.id, slug: "variables-and-data-types" } }, update: {}, create: { courseId: course.id, title: "Variables and Data Types", slug: "variables-and-data-types", content: "Variables store values used by a program.", sortOrder: 2, durationMin: 25 } });
  await prisma.product.upsert({ where: { slug: "programming-fundamentals-book" }, update: {}, create: { name: "Programming Fundamentals Book", slug: "programming-fundamentals-book", description: "Printed study material for programming fundamentals.", type: ProductType.BOOK, price: "450.00", stock: 100, isActive: true } });
  await prisma.product.upsert({ where: { slug: "programming-cheat-sheet" }, update: {}, create: { name: "Programming Cheat Sheet", slug: "programming-cheat-sheet", description: "Downloadable programming revision material.", type: ProductType.DIGITAL, price: "99.00", isActive: true } });
  console.log(`Seeded Shohoj Porashuna. Admin: ${adminEmail}`);
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
