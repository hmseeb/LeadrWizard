import { TemplateForm } from "@/components/template-form";
import { createTemplate } from "../actions";

export default function NewTemplatePage() {
  return (
    <div>
      <h1 className="text-2xl font-bold">Create Message Template</h1>
      <p className="mt-1 text-gray-500">
        Create a new outreach template for SMS, email, or voice messages.
      </p>
      <div className="mt-6">
        <TemplateForm mode="create" action={createTemplate} />
      </div>
    </div>
  );
}
