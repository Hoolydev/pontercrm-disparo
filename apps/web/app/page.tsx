export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Pointer Imóveis</h1>
      <p className="mt-3 text-neutral-600">
        Captação, qualificação e distribuição de leads via WhatsApp com IA.
      </p>

      <section className="mt-10 rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-medium">Setup local</h2>
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-neutral-700">
          <li>
            <code className="rounded bg-neutral-100 px-1.5 py-0.5">pnpm install</code>
          </li>
          <li>
            <code className="rounded bg-neutral-100 px-1.5 py-0.5">cp .env.example .env</code>
          </li>
          <li>
            <code className="rounded bg-neutral-100 px-1.5 py-0.5">pnpm infra:up</code>
          </li>
          <li>
            <code className="rounded bg-neutral-100 px-1.5 py-0.5">pnpm db:generate</code> →{" "}
            <code className="rounded bg-neutral-100 px-1.5 py-0.5">pnpm db:migrate</code>
          </li>
          <li>
            <code className="rounded bg-neutral-100 px-1.5 py-0.5">pnpm dev</code>
          </li>
        </ol>
      </section>
    </main>
  );
}
