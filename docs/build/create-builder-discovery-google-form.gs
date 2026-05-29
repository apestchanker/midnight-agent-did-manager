/**
 * Creates a neutral Google Form for first-pass builder discovery.
 *
 * How to use:
 * 1. Open https://script.google.com/ with your Google account.
 * 2. Create a new Apps Script project.
 * 3. Paste this whole file into Code.gs.
 * 4. Run createBuilderDiscoveryForm().
 * 5. Authorize the script.
 * 6. Check the execution log for the edit URL, public URL, and response Sheet URL.
 */
function createBuilderDiscoveryForm() {
  const form = FormApp.create("Agent and Automation Trust Workflows");
  form.setDescription(
    "This short research survey is for people building or operating software agents, automations, wallets, credential flows, or developer platforms. " +
      "The goal is to understand how teams manage agent identity, authorization, permissions, trust, and handoff workflows today.\n\n" +
      "Please answer from a real workflow you have seen or worked on. Specific past examples are more useful than opinions about what might happen in the future."
  );
  form.setCollectEmail(false);
  form.setAllowResponseEdits(false);
  form.setLimitOneResponsePerUser(false);
  form.setProgressBar(true);
  form.setConfirmationMessage("Thanks. Your response helps map real builder workflows and pain points.");

  addSection(form, "Fit");
  form.addTextItem().setTitle("Which best describes your current role?").setRequired(true);
  addCheckbox(
    form,
    "What kind of product or system do you build or operate?",
    [
      "Agent framework or agent platform",
      "AI automation product",
      "Developer tooling",
      "Wallet, credential, or identity-related product",
      "Privacy-preserving application",
      "Protocol, infrastructure, or app platform",
      "Internal enterprise automation",
      "Consulting or agency automation",
      "Other"
    ],
    true
  );
  form.addTextItem().setTitle("Where are you or your main users/customers primarily based?").setRequired(false);
  addMultipleChoice(
    form,
    "In the last six months, have you built, deployed, reviewed, or operated an automated agent or workflow?",
    ["Yes, in production", "Yes, in prototype or pilot", "Reviewed or evaluated one, but did not build it", "No"],
    true
  );
  addMultipleChoice(
    form,
    "Did that agent or automation interact with external systems, customers, vendors, partner APIs, wallets, or shared infrastructure?",
    ["Yes", "No", "Not sure"],
    true
  );
  addMultipleChoice(
    form,
    "Are you willing to describe one specific recent workflow or incident?",
    ["Yes", "Maybe, with some details anonymized", "No"],
    true
  );

  addSection(form, "Current Workflow");
  form
    .addParagraphTextItem()
    .setTitle("Briefly describe the last agent or automation workflow you built, operated, reviewed, or integrated.")
    .setRequired(true);
  form.addParagraphTextItem().setTitle("Where did identity, authorization, approval, or permissions show up in that workflow?").setRequired(true);
  addCheckbox(
    form,
    "Who needed to trust that the agent or automation was legitimate?",
    [
      "Internal team",
      "End users",
      "Customers",
      "Partner systems",
      "Vendors",
      "Security or compliance team",
      "Another agent or automated system",
      "Public/verifier outside the organization",
      "Nobody explicitly",
      "Other"
    ],
    true
  );
  addCheckbox(
    form,
    "Who needed to trust what the agent or automation was allowed to do?",
    [
      "Internal team",
      "End users",
      "Customers",
      "Partner systems",
      "Vendors",
      "Security or compliance team",
      "Another agent or automated system",
      "Public/verifier outside the organization",
      "Nobody explicitly",
      "Other"
    ],
    true
  );

  addSection(form, "Proof, Permissions, and Workarounds");
  addMultipleChoice(
    form,
    "Have you ever needed to prove who controls an agent, who approved it, what it is allowed to do, or whether it is still active?",
    ["Yes, often", "Yes, occasionally", "Once or twice", "Not yet, but likely soon", "No"],
    true
  );
  form.addParagraphTextItem().setTitle("Tell us about the last time that came up. What did someone ask for, and what did you actually show them?").setRequired(false);
  addCheckbox(
    form,
    "How do you identify agents or automations today?",
    [
      "API keys",
      "OAuth apps or service accounts",
      "Wallet addresses",
      "Internal IDs",
      "Logs or audit trails",
      "User accounts",
      "Config files",
      "Naming conventions",
      "Documentation or tickets",
      "We do not have a clear method",
      "Other"
    ],
    true
  );
  addCheckbox(
    form,
    "How do you represent what an agent or automation is allowed to do?",
    [
      "API scopes",
      "Roles or permission groups",
      "Policy files",
      "Prompt instructions",
      "Contracts or service agreements",
      "Tickets or approval records",
      "Documentation",
      "Hard-coded rules",
      "Manual review",
      "We do not have a clear method",
      "Other"
    ],
    true
  );
  addCheckbox(
    form,
    "What happens when an agent's permissions, purpose, limits, or approval changes?",
    [
      "Rotate or revoke API keys",
      "Update OAuth scopes or roles",
      "Update policy/config files",
      "Update documentation or tickets",
      "Notify partners/customers manually",
      "Rely on logs after the fact",
      "Deactivate the agent/account",
      "Not handled consistently",
      "Has not come up yet",
      "Other"
    ],
    true
  );
  addMultipleChoice(
    form,
    "Have stale credentials, unclear ownership, expired permissions, or manual revocation ever caused friction or risk?",
    [
      "Yes, caused a production or security issue",
      "Yes, blocked or delayed a launch/integration/deal",
      "Yes, caused internal friction but no major incident",
      "Not yet, but it is a concern",
      "No"
    ],
    true
  );
  addCheckbox(
    form,
    "What did that friction cost you?",
    [
      "Engineering time",
      "Security review time",
      "Customer/support time",
      "Delayed launch",
      "Delayed integration",
      "Lost deal or customer trust",
      "Increased compliance/audit work",
      "No measurable cost",
      "Other"
    ],
    false
  );
  addScale(
    form,
    "If you had to rate the pain of proving agent identity, permissions, and current authorization today, how severe is it?",
    1,
    5,
    "mild annoyance",
    "blocks deployment, deal, security, or trust",
    true
  );
  addScale(form, "How often does this pain show up?", 1, 5, "yearly or rarely", "daily or every workflow", true);

  addSection(form, "Disclosure and Trust");
  addMultipleChoice(
    form,
    "Have customers, partners, or other systems ever asked for more information than you wanted to disclose about an agent, automation, operator, or organization?",
    ["Yes", "No", "Not sure", "Has not come up yet"],
    true
  );
  form.addParagraphTextItem().setTitle("What did you share, redact, refuse, or work around?").setRequired(false);
  addCheckbox(
    form,
    "Which information should be easy to verify without exposing everything?",
    [
      "Agent identity",
      "Who controls or approved the agent",
      "Current status: active, expired, suspended, revoked",
      "Current purpose or mandate",
      "Allowed tools or actions",
      "Limits such as time, spend, data, or scope",
      "Authorization level or permission tier",
      "Organization or team affiliation",
      "Audit trail or approval history",
      "None of these",
      "Other"
    ],
    true
  );
  form.addParagraphTextItem().setTitle("What would make this kind of verification safer or more useful?").setRequired(false);

  addSection(form, "Trust Ladder and Follow-up");
  addScale(form, "On a scale of 1-10, how much do you trust your current setup for agent identity, permissions, and authorization?", 1, 10, "very low trust", "high trust", true);
  form.addParagraphTextItem().setTitle("What would move that trust score up by one point?").setRequired(true);
  addMultipleChoice(
    form,
    "Have you paid for, built, or allocated engineering time to solve identity, authorization, compliance, audit, or trust problems around agents or automations?",
    [
      "Yes, paid for a tool/service",
      "Yes, built an internal solution",
      "Yes, allocated engineering or security time",
      "No, but likely in the next 6 months",
      "No"
    ],
    true
  );
  form.addParagraphTextItem().setTitle("What would make this urgent in the next quarter?").setRequired(false);
  addMultipleChoice(form, "Would you be open to a 20-minute follow-up conversation?", ["Yes", "Maybe", "No"], true);
  form.addTextItem().setTitle("Optional: email or preferred contact method.").setRequired(false);

  const sheet = SpreadsheetApp.create("Agent and Automation Trust Workflows - Responses");
  form.setDestination(FormApp.DestinationType.SPREADSHEET, sheet.getId());

  Logger.log("Form edit URL: " + form.getEditUrl());
  Logger.log("Form public URL: " + form.getPublishedUrl());
  Logger.log("Responses Sheet URL: " + sheet.getUrl());
}

function addSection(form, title) {
  form.addPageBreakItem().setTitle(title);
}

function addMultipleChoice(form, title, choices, required) {
  const item = form.addMultipleChoiceItem().setTitle(title).setRequired(required);
  item.setChoices(choices.map((choice) => item.createChoice(choice)));
  return item;
}

function addCheckbox(form, title, choices, required) {
  const item = form.addCheckboxItem().setTitle(title).setRequired(required);
  item.setChoices(choices.map((choice) => item.createChoice(choice)));
  return item;
}

function addScale(form, title, lower, upper, lowerLabel, upperLabel, required) {
  return form.addScaleItem().setTitle(title).setBounds(lower, upper).setLabels(lowerLabel, upperLabel).setRequired(required);
}
