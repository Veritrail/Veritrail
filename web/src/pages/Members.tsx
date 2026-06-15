import { ProductShell } from "../components/ProductShell";
import { PageShell } from "../components/PageShell";
import { TeamMembersSettings } from "../components/TeamMembersSettings";
import { useMe } from "../hooks/useMe";

export default function Members() {
  const me = useMe();
  const isOwner = me.data?.role === "owner";
  return (
    <ProductShell>
      <PageShell
        eyebrow="Access"
        title="Members"
        description="Invite teammates and manage workspace roles."
        width="w-full"
      >
        <div className="max-w-3xl">
          {isOwner ? (
            <TeamMembersSettings />
          ) : (
            <p className="text-sm text-zinc-500">Only the workspace owner can manage members.</p>
          )}
        </div>
      </PageShell>
    </ProductShell>
  );
}
