"use client";

import { useState } from "react";
import Link from "next/link";
import { Pencil, Trash2, MoreVertical } from "lucide-react";
import { DeleteDialog } from "@/components/delete-dialog";
import { softDeleteService } from "./actions";

interface ServiceActionsProps {
  serviceId: string;
  serviceName: string;
}

export function ServiceActions({ serviceId, serviceName }: ServiceActionsProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    try {
      await softDeleteService(serviceId);
      setShowDelete(false);
    } catch {
      setDeleting(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setShowMenu(!showMenu)}
        className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
      >
        <MoreVertical className="h-4 w-4" />
      </button>

      {showMenu && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setShowMenu(false)}
          />
          <div className="absolute right-0 z-20 mt-1 w-36 rounded-lg border bg-white py-1 shadow-lg">
            <Link
              href={`/services/${serviceId}/edit`}
              className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              onClick={() => setShowMenu(false)}
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Link>
            <button
              type="button"
              onClick={() => {
                setShowMenu(false);
                setShowDelete(true);
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Deactivate
            </button>
          </div>
        </>
      )}

      <DeleteDialog
        open={showDelete}
        onClose={() => setShowDelete(false)}
        onConfirm={handleDelete}
        title={`Deactivate "${serviceName}"?`}
        description="This service will be hidden from package assignment. Existing clients using this service will not be affected. This can be reversed."
        confirmLabel="Deactivate"
        loading={deleting}
      />
    </div>
  );
}
