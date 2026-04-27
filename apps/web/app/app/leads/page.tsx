import { redirect } from "next/navigation";

// /app/leads → CRM (default = Kanban view)
export default function LeadsIndex() {
  redirect("/app/leads/kanban");
}
