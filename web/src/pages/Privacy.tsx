import { LegalSection, LegalShell } from "../components/LegalShell";

// Edit these three for your legal entity before launch.
const ENTITY = "Vigil";
const CONTACT_EMAIL = "privacy@vigil.app"; // TODO: replace with your real contact address
const UPDATED = "June 21, 2026";

export default function Privacy() {
  return (
    <LegalShell title="Privacy Policy" updated={UPDATED}>
      <p>
        This Privacy Policy explains what information {ENTITY} ("we", "us") collects when you use the Vigil
        service, why we collect it, how we protect it, and the choices you have. Vigil is a read-only cloud
        compliance-evidence tool for engineering teams.
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
            <strong>AWS connection details.</strong> The AWS account ID, the IAM role ARN you authorize, and an external
            ID. The role ARN and external ID are encrypted at rest.
          </li>
          <li>
            <strong>Scan results (configuration metadata).</strong> When you connect an account, Vigil assumes the
            read-only role you create and collects <em>configuration and metadata</em> about your AWS resources — for
            example IAM users, roles, policies and access-key usage; S3, KMS, EC2/EBS, VPC, RDS and similar resource
            settings; CloudTrail event metadata; and the findings and evidence snapshots derived from them. Vigil does
            <strong> not</strong> read the contents of your data stores (object/file contents) or the values of your
            secrets — only the configuration needed to evaluate posture.
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
          To provide and secure the service: authenticate you, scan the AWS accounts you connect, generate findings and
          auditor-ready evidence, send the notifications you configure, support you, prevent abuse, and meet our legal
          obligations. Where required, our legal bases are performance of our contract with you and our legitimate
          interest in operating a secure service.
        </p>
      </LegalSection>

      <LegalSection heading="How we store and protect it">
        <p>
          Data is encrypted in transit (TLS) and sensitive connection details (role ARN, external ID) are encrypted at
          rest. Access is restricted to the systems and personnel that need it to run the service.
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
          We do not sell your data. We share it only with service providers that help us run Vigil, under contract and
          only as needed:
        </p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li><strong>Cloud hosting / infrastructure</strong> — to operate the application and database.</li>
          <li><strong>Amazon Web Services</strong> — Vigil assumes the read-only role <em>you</em> create to scan your account.</li>
          <li><strong>Email delivery</strong> — to send digests, invitations, and alerts you opt into.</li>
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
        <p>Vigil is a business tool and is not directed to anyone under 16. We do not knowingly collect their data.</p>
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
