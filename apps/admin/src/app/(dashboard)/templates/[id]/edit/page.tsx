import { createSupabaseServerClient } from "@/lib/supabase-server";
import { notFound } from "next/navigation";
import { TemplateForm } from "@/components/template-form";
import { updateTemplate } from "../../actions";
import type { MessageTemplate } from "@leadrwizard/shared/types";

export default async function EditTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createSupabaseServerClient();
  const { data: template } = await supabase
    .from("message_templates")
    .select("*")
    .eq("id", id)
    .single();

  if (!template) notFound();

  const boundUpdateTemplate = updateTemplate.bind(null, id);

  return (
    <div>
      <h1 className="text-2xl font-bold">Edit Message Template</h1>
      <p className="mt-1 text-gray-500">
        Update the template content and preview with sample data.
      </p>
      <div className="mt-6">
        <TemplateForm
          mode="edit"
          initialData={template as MessageTemplate}
          action={boundUpdateTemplate}
        />
      </div>
    </div>
  );
}
