import type { Role } from "@pointer/shared";
import { boolean, index, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { createdAt, id, updatedAt } from "./_common.js";

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").$type<Role>().notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt()
  },
  (t) => ({
    emailIdx: uniqueIndex("users_email_uq").on(t.email),
    roleIdx: index("users_role_idx").on(t.role)
  })
);

export type UserRow = typeof users.$inferSelect;
export type UserInsert = typeof users.$inferInsert;
