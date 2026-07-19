import { LegalSection, LegalShell } from "../components/LegalShell";

const ENTITY = "Veritrail";
const CONTACT_EMAIL = "support@veritrail.io";
const GOVERNING_LAW = "the State of Israel";
const UPDATED = "July 11, 2026";

export default function Terms() {
  return (
    <LegalShell title="Terms of Service" updated={UPDATED}>
      <p>
        These Terms govern your use of the Veritrail service provided by {ENTITY} ("we", "us"). By creating an account or
        using Veritrail, you agree to them. If you use Veritrail on behalf of an organization, you represent that you are
        authorized to bind it.
      </p>

      <LegalSection heading="The service">
        <p>
          Veritrail is a read-only, scanning-only compliance-evidence tool. You connect your cloud providers (AWS,
          Google Cloud, Azure) and developer tools (such as GitHub, GitLab, identity providers, ticketing, and
          vulnerability scanners) using read-only access you authorize; Veritrail collects configuration and metadata,
          ranks findings, maps them to compliance frameworks, and produces auditor-ready evidence. Veritrail never
          modifies your customer environments. Remediation guidance shown alongside findings is informational only —
          any changes are made by you, in your own accounts. The "Verify fix" feature is a read-only re-check of a
          finding after you apply a fix yourself.
        </p>
      </LegalSection>

      <LegalSection heading="Your account">
        <p>
          You are responsible for the accuracy of your account information, for safeguarding your credentials, and for
          all activity under your account. Notify us promptly of any unauthorized use.
        </p>
      </LegalSection>

      <LegalSection heading="Your connected accounts">
        <p>
          You are responsible for creating and maintaining the read-only roles, service accounts, or tokens you authorize,
          and for confirming you have the right to connect each cloud account or tool you add. You may disconnect any
          connected account or integration at any time.
        </p>
      </LegalSection>

      <LegalSection heading="No compliance or audit guarantee">
        <p>
          Veritrail helps you <em>prepare</em> and <em>evidence</em> your security posture. It is not an auditor, does not
          issue certifications, and does not guarantee that you will pass any audit or meet any standard (including
          SOC&nbsp;2, CIS, or ISO). Findings, control statuses, and scores are informational aids, not legal, compliance,
          or professional advice. A licensed assessor — not Veritrail — determines audit outcomes.
        </p>
      </LegalSection>

      <LegalSection heading="Acceptable use">
        <p>You agree not to misuse the service, including by attempting to:</p>
        <ul className="list-disc space-y-1.5 pl-5">
          <li>access accounts or data you are not authorized to access;</li>
          <li>disrupt, probe, or reverse engineer the service except as permitted by law;</li>
          <li>use the service to violate any law or third-party rights.</li>
        </ul>
      </LegalSection>

      <LegalSection heading="Fees">
        <p>
          Paid plans are billed as described at the time of purchase (for example, a per-account subscription, with a
          free trial where offered). Fees are non-refundable except where required by law.
        </p>
      </LegalSection>

      <LegalSection heading="Intellectual property">
        <p>
          We own the Veritrail software and service. You own your data. You grant us the limited rights needed to operate
          the service and provide it to you.
        </p>
      </LegalSection>

      <LegalSection heading="Disclaimers">
        <p>
          The service is provided "as is" and "as available," without warranties of any kind, whether express or
          implied, including merchantability, fitness for a particular purpose, and non-infringement. We do not warrant
          that the service will be uninterrupted, error-free, or that it will detect every misconfiguration or risk.
        </p>
      </LegalSection>

      <LegalSection heading="Limitation of liability">
        <p>
          To the maximum extent permitted by law, {ENTITY} will not be liable for any indirect, incidental, special,
          consequential, or punitive damages, or for lost profits or data. Our total liability for any claim relating to
          the service will not exceed the amount you paid us in the twelve months before the claim.
        </p>
      </LegalSection>

      <LegalSection heading="Indemnification">
        <p>
          You will indemnify {ENTITY} against claims arising from your misuse of the service or your violation of these
          Terms or applicable law.
        </p>
      </LegalSection>

      <LegalSection heading="Termination">
        <p>
          You may stop using Veritrail and delete your account at any time. We may suspend or terminate access for breach of
          these Terms or to protect the service and its users.
        </p>
      </LegalSection>

      <LegalSection heading="Governing law">
        <p>These Terms are governed by the laws of {GOVERNING_LAW}, without regard to conflict-of-laws rules.</p>
      </LegalSection>

      <LegalSection heading="Changes">
        <p>
          We may update these Terms. We will revise the "Last updated" date and, for material changes, notify you in the
          app or by email. Continued use after changes take effect means you accept them.
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
