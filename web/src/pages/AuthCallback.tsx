import { useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api, storeTokens, storeSessionAvatarUrl } from "../api";
import { postAuthPath } from "../lib/postAuthRedirect";

const PENDING_INVITE_KEY = "veritrail_pending_invite_token";

export default function AuthCallback() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    const token = params.get("token");
    const avatarUrl = params.get("avatar_url");
    const error = params.get("error");

    void (async () => {
      if (token) {
        storeTokens(token);
        if (avatarUrl) storeSessionAvatarUrl(avatarUrl);
        const pendingInvite = sessionStorage.getItem(PENDING_INVITE_KEY);
        if (pendingInvite) {
          try {
            const res = await api<{ access_token: string }>("/v1/members/invites/accept", {
              method: "POST",
              body: JSON.stringify({ token: pendingInvite }),
            });
            sessionStorage.removeItem(PENDING_INVITE_KEY);
            storeTokens(res.access_token);
          } catch {
            /* fall through — user can reopen invite link */
          }
        }
        nav(await postAuthPath(), { replace: true });
      } else {
        nav(`/login?error=${error ?? "unknown"}`, { replace: true });
      }
    })();
  }, [nav, params]);

  return (
    <div className="min-h-screen bg-zinc-900 flex items-center justify-center text-white text-sm">
      Signing in…
    </div>
  );
}
