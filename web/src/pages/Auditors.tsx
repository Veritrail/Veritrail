import { ProductShell } from "../components/ProductShell";
import { PageShell } from "../components/PageShell";
import { AuditorManagement } from "../components/AuditorManagement";
import { roleAtLeast, useMe } from "../hooks/useMe";

export default function Auditors() {
  const me = useMe();
  const canEdit = roleAtLeast(me.data?.role, "admin");
  return (
    <ProductShell>
      <PageShell
        eyebrow="Access"
        title="Auditors"
        description="Invite external auditors and manage their time-boxed access to your evidence."
        width="w-full"
      >
        <div className="max-w-3xl">
          {canEdit ? (
            <AuditorManagement />
          ) : (
            <p className="text-sm text-zinc-500">Admins and owners can manage auditor access.</p>
          )}
        </div>
      </PageShell>
    </ProductShell>
  );
}
