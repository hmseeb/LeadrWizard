import { ServiceForm } from "@/components/service-form";
import { createService } from "../actions";

export default function NewServicePage() {
  return (
    <div>
      <h1 className="text-2xl font-bold">Add Service</h1>
      <p className="mt-1 text-gray-500">
        Define a new service and configure what data it requires from clients.
      </p>
      <div className="mt-6">
        <ServiceForm mode="create" action={createService} />
      </div>
    </div>
  );
}
