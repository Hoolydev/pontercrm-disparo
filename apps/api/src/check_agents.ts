import { createDb, schema } from "@pointer/db";
const db = createDb(process.env.DATABASE_URL!);
const agents = await db.query.agents.findMany();
console.log('Agents:', agents.map(a => ({ id: a.id, name: a.name, type: a.type })));
process.exit(0);
