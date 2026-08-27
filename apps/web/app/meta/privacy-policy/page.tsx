/**
 * Public privacy policy page, required by Meta before the app can be
 * published (Publish requires a Privacy Policy URL in App Settings) --
 * same pattern as /unsubscribed: public, no auth, no dashboard chrome.
 * Content supplied by EurosHub; not editable in-app, so it's plain JSX
 * rather than pulled from a CMS/DB.
 */

export const metadata = {
  title: "Privacy Policy — Outly",
};

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-10 text-lg font-semibold tracking-tight">{children}</h2>;
}

function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="mt-6 text-sm font-semibold uppercase tracking-wide text-ink/70">{children}</h3>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-3 text-sm leading-relaxed text-ink/75">{children}</p>;
}

function UL({ children }: { children: React.ReactNode }) {
  return <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-ink/75">{children}</ul>;
}

export default function MetaPrivacyPolicyPage() {
  return (
    <main className="flex min-h-screen justify-center p-6 sm:p-10">
      <article className="w-full max-w-3xl pb-20">
        <div className="mb-8 flex items-center gap-3">
          <span
            aria-hidden
            className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-sm font-bold text-white shadow-sm"
          >
            AI
          </span>
          <div>
            <div className="text-sm font-semibold">Outly</div>
            <div className="text-xs text-ink/50">by EurosHub</div>
          </div>
        </div>

        <div className="card p-7 sm:p-10">
          <h1 className="text-xl font-semibold tracking-tight">Privacy Policy</h1>
          <p className="mt-2 text-xs text-ink/50">Effective Date: August 27, 2026</p>
          <p className="text-xs text-ink/50">Last Updated: August 27, 2026</p>

          <P>
            This Privacy Policy explains how <strong>EurosHub</strong> (&quot;we&quot;, &quot;our&quot;, or &quot;us&quot;)
            collects, uses, stores, and protects information when users connect or interact with our platform and its
            integrations with Meta services, including <strong>Facebook, Instagram, and WhatsApp</strong>.
          </P>
          <P>
            Our platform is a business management and social media management system that allows authorized users to
            manage company social media accounts, communications, leads, and related business activities from a
            centralized dashboard.
          </P>
          <P>
            By connecting a Meta account or using a Meta-integrated feature, you acknowledge the practices described
            in this Privacy Policy.
          </P>

          <H2>1. Meta Services We Use</H2>
          <P>Our platform may integrate with the following Meta services:</P>
          <UL>
            <li>Facebook</li>
            <li>Instagram</li>
            <li>WhatsApp / WhatsApp Business</li>
            <li>Meta Business tools and APIs</li>
          </UL>
          <P>
            The specific Meta services and permissions used may depend on the features enabled for a particular
            account.
          </P>

          <H2>2. Information We Collect</H2>
          <P>
            Depending on the Meta services connected to our platform, we may receive information permitted by the
            applicable Meta APIs and the permissions authorized by the account owner. This may include:
          </P>

          <H3>Account Information</H3>
          <UL>
            <li>Facebook Page information</li>
            <li>Instagram account information</li>
            <li>Instagram username and profile information</li>
            <li>WhatsApp Business account information</li>
            <li>Business/Page identifiers</li>
            <li>Account IDs</li>
            <li>Profile or Page images where available</li>
            <li>Account connection and authorization information</li>
          </UL>

          <H3>Messages and Communications</H3>
          <P>Where the relevant Meta API permissions allow it, we may process:</P>
          <UL>
            <li>Instagram messages</li>
            <li>Facebook Page messages</li>
            <li>WhatsApp Business messages</li>
            <li>Message timestamps</li>
            <li>Sender/recipient identifiers</li>
            <li>Conversation identifiers</li>
            <li>Message content</li>
            <li>Attachments or media associated with communications, where permitted</li>
          </UL>

          <H3>Social Media Content</H3>
          <P>Depending on the connected account and permissions, our platform may process:</P>
          <UL>
            <li>Posts</li>
            <li>Captions</li>
            <li>Images</li>
            <li>Videos</li>
            <li>Comments</li>
            <li>Reactions</li>
            <li>Engagement information</li>
            <li>Publishing information</li>
          </UL>

          <H3>Lead Information</H3>
          <P>
            When a person contacts our business through Facebook, Instagram, WhatsApp, or another connected channel,
            information provided by that person may be stored as a business lead. This may include:
          </P>
          <UL>
            <li>Name</li>
            <li>Email address</li>
            <li>Phone number</li>
            <li>WhatsApp number</li>
            <li>Social media username</li>
            <li>Company</li>
            <li>Message</li>
            <li>Source</li>
            <li>Conversation history</li>
            <li>Lead status</li>
            <li>Tags</li>
            <li>Notes</li>
            <li>Relevant interaction history</li>
          </UL>
          <P>We only process information necessary for the relevant business-management purpose.</P>

          <H2>3. How We Use Meta Data</H2>
          <P>We use information obtained through Meta services for legitimate business and platform-management purposes, including:</P>
          <UL>
            <li>Managing our company&apos;s Facebook, Instagram, and WhatsApp accounts</li>
            <li>Publishing and scheduling approved social media content</li>
            <li>Managing social media interactions</li>
            <li>Reviewing messages and conversations</li>
            <li>Responding to customer inquiries</li>
            <li>Identifying and managing potential business leads</li>
            <li>Maintaining lead and customer communication history</li>
            <li>Connecting conversations with existing leads</li>
            <li>Providing team members with authorized access to business communications</li>
            <li>Monitoring social media performance</li>
            <li>Generating internal analytics and reports</li>
            <li>Automating approved business workflows</li>
            <li>Maintaining and improving our internal business-management system</li>
            <li>Protecting the security and integrity of our platform</li>
          </UL>
          <P>We do not use Meta data for purposes unrelated to the functionality described in this Privacy Policy.</P>

          <H2>4. Lead Management</H2>
          <P>Our platform may receive inquiries from Facebook, Instagram, and WhatsApp.</P>
          <P>
            Where an individual contacts our business and provides information indicating an interest in our
            products or services, the information may be added to our centralized lead-management system.
          </P>
          <P>For example: an Instagram message indicating a potential business inquiry results in a lead being created or linked to an existing lead, which an authorized team member then reviews and responds to.</P>
          <P>
            The purpose of this processing is to help our business respond to inquiries and manage legitimate
            customer or prospect relationships.
          </P>

          <H2>5. Social Media Management</H2>
          <P>Authorized users may connect company-owned or company-authorized Meta accounts to our platform.</P>
          <P>Depending on available API permissions, authorized users may be able to:</P>
          <UL>
            <li>View connected accounts</li>
            <li>Create content</li>
            <li>Schedule content</li>
            <li>Publish content</li>
            <li>Manage posts</li>
            <li>Monitor interactions</li>
            <li>Review comments</li>
            <li>Review messages</li>
            <li>Manage leads</li>
            <li>View permitted analytics</li>
          </UL>
          <P>
            Actions are performed only on accounts that have been properly authorized and only to the extent
            permitted by the applicable Meta APIs and permissions.
          </P>

          <H2>6. WhatsApp Data</H2>
          <P>
            Where WhatsApp Business functionality is enabled, our platform may process business conversations
            received through the connected WhatsApp Business account.
          </P>
          <P>This information may be used to:</P>
          <UL>
            <li>Respond to customer inquiries</li>
            <li>Manage conversations</li>
            <li>Identify potential leads</li>
            <li>Maintain communication history</li>
            <li>Assign conversations to authorized team members</li>
            <li>Trigger permitted business workflows</li>
            <li>Associate conversations with existing leads</li>
          </UL>
          <P>We do not use WhatsApp message data for unrelated purposes.</P>

          <H2>7. Facebook and Instagram Data</H2>
          <P>
            Where Facebook or Instagram integrations are enabled, our platform may process information required to
            provide the connected functionality.
          </P>
          <P>Depending on the permissions granted, this may include:</P>
          <UL>
            <li>Account information</li>
            <li>Page information</li>
            <li>Posts</li>
            <li>Comments</li>
            <li>Messages</li>
            <li>Engagement information</li>
            <li>Media</li>
            <li>Business-related account identifiers</li>
          </UL>
          <P>The information is used to manage our authorized business accounts and customer interactions.</P>

          <H2>8. Sharing of Meta Data</H2>
          <P>We do not sell Meta platform data.</P>
          <P>We do not use Meta data for unrelated advertising, profiling, or data-broker activities.</P>
          <P>Meta data may be accessible to:</P>
          <UL>
            <li>Authorized employees</li>
            <li>Authorized contractors</li>
            <li>Service providers required to operate our platform</li>
            <li>Infrastructure and hosting providers</li>
            <li>Security and technology providers</li>
          </UL>
          <P>
            Such access is limited to what is necessary to provide, secure, maintain, or operate the relevant
            business functionality.
          </P>
          <P>
            Where third-party service providers process information on our behalf, we require appropriate
            contractual and security measures where applicable.
          </P>

          <H2>9. Data Retention</H2>
          <P>We retain information only for as long as reasonably necessary for the purposes described in this Privacy Policy, including:</P>
          <UL>
            <li>Providing the requested services</li>
            <li>Maintaining business and communication records</li>
            <li>Managing leads and customer relationships</li>
            <li>Meeting legal or contractual obligations</li>
            <li>Resolving disputes</li>
            <li>Preventing fraud and abuse</li>
            <li>Maintaining security and audit records</li>
          </UL>
          <P>When information is no longer required, we may delete or anonymize it in accordance with our data-retention practices.</P>

          <H2>10. Disconnecting a Meta Account</H2>
          <P>
            An authorized user may disconnect a Facebook, Instagram, or WhatsApp integration from our platform where
            the relevant functionality allows it.
          </P>
          <P>Disconnecting an account will stop future API access through that authorization.</P>
          <P>
            However, information previously received and stored by our platform may remain in our systems where it
            is necessary for legitimate business, legal, security, accounting, or record-keeping purposes.
          </P>
          <P>Users may contact us to request deletion of information where applicable.</P>

          <H2>11. Data Deletion</H2>
          <P>Users may request deletion of personal information associated with their interaction with our services.</P>
          <P>
            To request deletion, contact:{" "}
            <a className="text-accent hover:underline" href="mailto:hello@euroshub.com">
              hello@euroshub.com
            </a>
          </P>
          <P>Please include enough information for us to identify the relevant account or information.</P>
          <P>We will review deletion requests and process them in accordance with applicable law and our legal obligations.</P>
          <P>Where applicable, users may also use the account/data deletion functionality provided by the relevant Meta service.</P>

          <H2>12. Security</H2>
          <P>We take reasonable technical and organizational measures to protect information processed through our platform.</P>
          <P>Depending on the data and functionality, these measures may include:</P>
          <UL>
            <li>Encrypted connections</li>
            <li>Secure authentication</li>
            <li>Role-based access control</li>
            <li>Restricted administrative access</li>
            <li>Secure API authentication</li>
            <li>Secure storage of access credentials/tokens</li>
            <li>Access logging</li>
            <li>Monitoring</li>
            <li>Backup and recovery procedures</li>
          </UL>
          <P>Meta access tokens and other sensitive authentication information are not intentionally exposed to ordinary users.</P>
          <P>No internet-based system can be guaranteed to be completely secure, but we take reasonable steps to protect the information entrusted to us.</P>

          <H2>13. User Access and Permissions</H2>
          <P>Our platform may provide different access levels to employees and authorized team members. For example:</P>
          <UL>
            <li>Administrators may manage integrations and permissions.</li>
            <li>Managers may access assigned accounts and communications.</li>
            <li>Team members may access only the accounts or conversations assigned to them.</li>
          </UL>
          <P>
            Access to Meta-related data is limited according to the permissions configured within our platform and
            the permissions granted by the connected Meta account.
          </P>

          <H2>14. Automated Processing</H2>
          <P>Our platform may use automation and, where enabled, artificial intelligence to assist with business operations. Examples may include:</P>
          <UL>
            <li>Categorizing incoming messages</li>
            <li>Identifying potential leads</li>
            <li>Suggesting lead categories</li>
            <li>Generating content drafts</li>
            <li>Suggesting responses</li>
            <li>Creating internal summaries</li>
            <li>Triggering business workflows</li>
          </UL>
          <P>
            Automated processing is intended to assist authorized users and should not be interpreted as replacing
            human review where human judgment is required.
          </P>
          <P>
            We will not use automated processing to perform actions that are not supported by the applicable Meta
            permissions or our stated business purposes.
          </P>

          <H2>15. Children&apos;s Privacy</H2>
          <P>Our services are intended for business and professional use.</P>
          <P>
            We do not knowingly use our platform to collect personal information from children for purposes
            unrelated to the services we provide.
          </P>
          <P>
            If you believe that information belonging to a child has been submitted to us improperly, please contact
            us at{" "}
            <a className="text-accent hover:underline" href="mailto:hello@euroshub.com">
              hello@euroshub.com
            </a>
            .
          </P>

          <H2>16. International Data Processing</H2>
          <P>
            Our company and service providers may process information in countries other than the country where the
            information was originally collected.
          </P>
          <P>Where required by applicable law, we will implement appropriate safeguards for international data transfers.</P>

          <H2>17. Changes to This Privacy Policy</H2>
          <P>We may update this Privacy Policy from time to time to reflect:</P>
          <UL>
            <li>Changes to our services</li>
            <li>Changes to Meta integrations</li>
            <li>Changes to applicable APIs</li>
            <li>Changes to legal or regulatory requirements</li>
            <li>Changes to our data-processing practices</li>
          </UL>
          <P>The updated version will be published on this page with an updated &quot;Last Updated&quot; date.</P>

          <H2>18. Contact Us</H2>
          <P>If you have questions about this Privacy Policy, our Meta integrations, or the processing of your information, contact us:</P>
          <UL>
            <li>
              <strong>Company:</strong> EurosHub
            </li>
            <li>
              <strong>Website:</strong>{" "}
              <a className="text-accent hover:underline" href="http://www.euroshub.com">
                www.euroshub.com
              </a>
            </li>
            <li>
              <strong>Email:</strong>{" "}
              <a className="text-accent hover:underline" href="mailto:hello@euroshub.com">
                hello@euroshub.com
              </a>
            </li>
            <li>
              <strong>Address:</strong> Office 509, 5th floor, Kohistan Tower, Saddar, Rawalpindi
            </li>
          </UL>

          <H2>19. Meta Platform Compliance</H2>
          <P>
            Our use of Facebook, Instagram, and WhatsApp data is subject to the applicable Meta platform terms,
            developer policies, API documentation, and permissions granted to our application.
          </P>
          <P>
            We intend to use Meta data only for the functionality and business purposes described above and only to
            the extent permitted by the applicable Meta platform policies and API access.
          </P>
          <P>
            Where Meta provides additional requirements concerning access, storage, deletion, or use of platform
            data, we will comply with those requirements as applicable.
          </P>
        </div>
      </article>
    </main>
  );
}
