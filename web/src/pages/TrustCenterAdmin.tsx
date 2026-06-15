import { ProductShell } from "../components/ProductShell";
import { PageShell } from "../components/PageShell";
import { TrustCenterSettings } from "../components/TrustCenterSettings";
import { roleAtLeast, useMe } from "../hooks/useMe";

export default function TrustCenterAdmin() {
  const me = useMe();
  const canEdit = roleAtLeast(me.data?.role, "admin");
  return (
    <ProductShell>
      <PageShell
        eyebrow="Public profile"
        title="Trust Center"
        description="Build and publish a marketing-safe public security profile for prospects and customers."
        width="w-full"
      >
        <div className="max-w-3xl">
          {canEdit ? (
            <TrustCenterSettings />
          ) : (
            <p className="text-sm text-zinc-500">Admins and owners can manage the Trust Center.</p>
          )}
        </div>
      </PageShell>
    </ProductShell>
  );
}
