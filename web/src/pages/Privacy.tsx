import { LegalSection, LegalShell } from "../components/LegalShell";

const ENTITY = "Veritrail";
const CONTACT_EMAIL = "support@veritrail.io";
const UPDATED = "July 11, 2026";

export default function Privacy() {
  return (
    <LegalShell title="Privacy Policy" updated={UPDATED}>
      <p>
        This Privacy Policy explains what information {ENTITY} ("we", "us") collects when you use the Veritrail
        service, why we collect it, how we protect it, and the choices you have. Veritrail is a read-only compliance-evidence
        tool for engineering teams: it connects to your cloud providers (AWS, Google Cloud, Azure) and developer tools
        (such as GitHub, GitLab, identity providers, and vulnerability scanners) to collect configuration evidence and map
        it to compliance frameworks. Veritrail never modifies your environments.
      </p>

      <LegalSection heading="Information we collect">
        <p>We collect the following categories of data:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>
            <strong>Account &amp; identity.</strong> Your name, email address, a securely hashed password, and — if you
            sign in with a provider — your GitHub, Google, or GitLab identifier. If you enable multi-factor
            authentication, we store the data needed to verify it.
          </li>
          <li>
            <strong>Workspace.</strong> Organization name, verified company domains, members, and their roles.
          </li>
          <li>
            <strong>Cloud &amp; integration connection details.</strong> The credentials you authorize us to use to
            connect each provider — for example an AWS account ID with an IAM role ARN and external ID, a Google Cloud
            workload-identity or service-account configuration, an Azure subscription and app registration, and the OAuth
            tokens or API keys for developer tools you connect (such as GitHub, GitLab, Google Workspace, Microsoft Entra
            ID, Jira, and vulnerability scanners). These connection secrets are encrypted at rest.
          </li>
          <li>
            <strong>Scan results (configuration metadata).</strong> Using the read-only access you authorize, Veritrail
            collects <em>configuration and metadata</em> from the accounts and tools you connect — for example cloud IAM
            principals, policies and key usage; storage, network, database and encryption settings; audit-log metadata;
            source-control branch-protection and review settings; identity-provider user and MFA status; scanner findings;
            and the findings and evidence snapshots derived from them. Veritrail does <strong>not</strong> read the
            contents of your data stores (object/file contents) or the values of your secrets — only the configuration
            needed to evaluate posture.
          </li>
          <li>
            <strong>Usage &amp; operational data.</strong> IP address, request logs, and an audit log of privileged
            actions taken in your workspace (e.g. connecting an account, changing settings, inviting members).
          </li>
          <li>
            <strong>Cookies.</strong> We use strictly necessary cookies to keep you signed in (session/refresh tokens).
            We do not use advertising cookies.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="Why we collect it">
        <p>
          To provide and secure the service: authenticate you, collect evidence from the accounts and tools you connect,
          generate findings and auditor-ready evidence, send the notifications you configure, support you, prevent abuse,
          and meet our legal obligations. Where required, our legal bases are performance of our contract with you and our
          legitimate interest in operating a secure service.
        </p>
      </LegalSection>

      <LegalSection heading="Where and how we store it">
        <p>
          Application data and evidence data are hosted on Hetzner infrastructure in the European Union. Data is
          encrypted in transit (TLS) and sensitive connection details (role ARN, external ID) are encrypted at rest.
          Access is restricted to the systems and personnel that need it to run the service.
        </p>
      </LegalSection>

      <LegalSection heading="How long we keep it">
        <p>
          We retain account and workspace data while your account is active and for a limited period afterward.
          Operational audit logs are retained for roughly twelve months. Scan results and evidence snapshots are kept so
          your evidence packs remain available for the relevant period. You can ask us to delete your data (see "Your
          rights").
        </p>
      </LegalSection>

      <LegalSection heading="Who we share it with">
        <p>
          We do not sell your data. We share it only with service providers (subprocessors) that help us run Veritrail,
          under contract and only as needed:
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li><strong>Cloud hosting / infrastructure</strong> — Hetzner (EU) hosts the application and database.</li>
          <li>
            <strong>The providers you connect</strong> — Veritrail uses the read-only access <em>you</em> authorize to
            reach your cloud accounts (AWS, Google Cloud, Azure) and developer tools (such as GitHub, GitLab, identity
            providers, ticketing, and scanners). We only access what you connect.
          </li>
          <li>
            <strong>Email delivery</strong> — a transactional email (SMTP) provider, used to send digests, invitations,
            and alerts you opt into.
          </li>
        </ul>
        <p>We may also disclose data if required by law or to protect our rights and users.</p>
      </LegalSection>

      <LegalSection heading="Your rights">
        <p>
          Depending on where you live, you may have the right to access, correct, export, restrict, or delete your
          personal data, and to object to certain processing. To exercise any of these, email us at{" "}
          <a className="font-medium text-[#0d9488]" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. We do not sell
          personal information.
        </p>
      </LegalSection>

      <LegalSection heading="Children">
        <p>Veritrail is a business tool for organizations and isn't intended for anyone under 16. We don't direct our services to children or knowingly collect their personal data. If we learn we've done so, we'll delete it.</p>
      </LegalSection>

      <LegalSection heading="Changes to this policy">
        <p>
          We may update this policy as the service evolves. We will revise the "Last updated" date above and, for
          material changes, notify you in the app or by email.
        </p>
      </LegalSection>

      <LegalSection heading="Contact">
        <p>
          Questions? Email{" "}
          <a className="font-medium text-[#0d9488]" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </LegalSection>
    </LegalShell>
  );
}
