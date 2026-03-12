import { createSupabaseServerClient } from "@/lib/supabase-server";

export default async function TemplatesPage() {
  const supabase = await createSupabaseServerClient();
  const { data: templates } = await supabase
    .from("niche_templates")
    .select("*")
    .order("niche_name", { ascending: true });

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Niche Templates</h1>
          <p className="mt-1 text-gray-500">
            Website template library by industry. Each niche only needs one
            template — reused for all clients in that niche.
          </p>
        </div>
        <button className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
          Add Template
        </button>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {templates?.map((template) => (
          <div key={template.id} className="rounded-lg border bg-white p-6">
            <h3 className="text-lg font-semibold">{template.niche_name}</h3>
            {template.description && (
              <p className="mt-1 text-sm text-gray-500">
                {template.description}
              </p>
            )}
            <div className="mt-4 text-xs text-gray-400">
              Created {new Date(template.created_at).toLocaleDateString()}
            </div>
            {template.preview_url && (
              <a
                href={template.preview_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-block text-sm text-brand-600 hover:text-brand-700"
              >
                Preview →
              </a>
            )}
          </div>
        ))}
        {(!templates || templates.length === 0) && (
          <div className="col-span-3 rounded-lg border bg-white p-8 text-center text-gray-400">
            No templates yet. Templates are created once per niche and reused
            for all clients.
          </div>
        )}
      </div>
    </div>
  );
}
