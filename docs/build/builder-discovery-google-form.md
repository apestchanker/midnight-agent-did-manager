# Google Form: Builder Discovery Survey

Purpose: first-pass discovery with builders using neutral language focused on current workflows, pains, and workarounds.

Estimated completion time: 8-10 minutes.

## Form Title

Agent and Automation Trust Workflows

## Form Description

This short research survey is for people building or operating software agents, automations, wallets, credential flows, or developer platforms. The goal is to understand how teams manage agent identity, authorization, permissions, trust, and handoff workflows today.

Please answer from a real workflow you have seen or worked on. Specific past examples are more useful than opinions about what might happen in the future.

## Section 1: Fit

1. Which best describes your current role?
   - Type: short answer
   - Required: yes
   - Log mapping: `interviewee_role`

2. What kind of product or system do you build or operate?
   - Type: checkboxes
   - Required: yes
   - Options:
     - Agent framework or agent platform
     - AI automation product
     - Developer tooling
     - Wallet, credential, or identity-related product
     - Privacy-preserving application
     - Protocol, infrastructure, or app platform
     - Internal enterprise automation
     - Consulting or agency automation
     - Other
   - Log mapping: `company_type`

3. Where are you or your main users/customers primarily based?
   - Type: short answer
   - Required: no
   - Log mapping: `geo`

4. In the last six months, have you built, deployed, reviewed, or operated an automated agent or workflow?
   - Type: multiple choice
   - Required: yes
   - Options:
     - Yes, in production
     - Yes, in prototype or pilot
     - Reviewed or evaluated one, but did not build it
     - No

5. Did that agent or automation interact with external systems, customers, vendors, partner APIs, wallets, or shared infrastructure?
   - Type: multiple choice
   - Required: yes
   - Options:
     - Yes
     - No
     - Not sure

6. Are you willing to describe one specific recent workflow or incident?
   - Type: multiple choice
   - Required: yes
   - Options:
     - Yes
     - Maybe, with some details anonymized
     - No

## Section 2: Current Workflow

7. Briefly describe the last agent or automation workflow you built, operated, reviewed, or integrated.
   - Type: paragraph
   - Required: yes
   - Log mapping: `raw_quote`

8. Where did identity, authorization, approval, or permissions show up in that workflow?
   - Type: paragraph
   - Required: yes
   - Log mapping: `identity_gap`, `authorization_level_gap`

9. Who needed to trust that the agent or automation was legitimate?
   - Type: checkboxes
   - Required: yes
   - Options:
     - Internal team
     - End users
     - Customers
     - Partner systems
     - Vendors
     - Security or compliance team
     - Another agent or automated system
     - Public/verifier outside the organization
     - Nobody explicitly
     - Other
   - Log mapping: `trust_gap`

10. Who needed to trust what the agent or automation was allowed to do?
    - Type: checkboxes
    - Required: yes
    - Options:
      - Internal team
      - End users
      - Customers
      - Partner systems
      - Vendors
      - Security or compliance team
      - Another agent or automated system
      - Public/verifier outside the organization
      - Nobody explicitly
      - Other
    - Log mapping: `mandate_gap`, `capability_or_limit_gap`

## Section 3: Proof, Permissions, and Workarounds

11. Have you ever needed to prove who controls an agent, who approved it, what it is allowed to do, or whether it is still active?
    - Type: multiple choice
    - Required: yes
    - Options:
      - Yes, often
      - Yes, occasionally
      - Once or twice
      - Not yet, but likely soon
      - No
    - Log mapping: `frequency_1_5`

12. Tell us about the last time that came up. What did someone ask for, and what did you actually show them?
    - Type: paragraph
    - Required: no
    - Log mapping: `pain_in_customer_words`, `raw_quote`

13. How do you identify agents or automations today?
    - Type: checkboxes
    - Required: yes
    - Options:
      - API keys
      - OAuth apps or service accounts
      - Wallet addresses
      - Internal IDs
      - Logs or audit trails
      - User accounts
      - Config files
      - Naming conventions
      - Documentation or tickets
      - We do not have a clear method
      - Other
    - Log mapping: `current_workaround`, `identity_gap`

14. How do you represent what an agent or automation is allowed to do?
    - Type: checkboxes
    - Required: yes
    - Options:
      - API scopes
      - Roles or permission groups
      - Policy files
      - Prompt instructions
      - Contracts or service agreements
      - Tickets or approval records
      - Documentation
      - Hard-coded rules
      - Manual review
      - We do not have a clear method
      - Other
    - Log mapping: `current_workaround`, `mandate_gap`, `capability_or_limit_gap`

15. What happens when an agent's permissions, purpose, limits, or approval changes?
    - Type: checkboxes
    - Required: yes
    - Options:
      - Rotate or revoke API keys
      - Update OAuth scopes or roles
      - Update policy/config files
      - Update documentation or tickets
      - Notify partners/customers manually
      - Rely on logs after the fact
      - Deactivate the agent/account
      - Not handled consistently
      - Has not come up yet
      - Other
    - Log mapping: `current_workaround`, `mandate_gap`, `capability_or_limit_gap`

16. Have stale credentials, unclear ownership, expired permissions, or manual revocation ever caused friction or risk?
    - Type: multiple choice
    - Required: yes
    - Options:
      - Yes, caused a production or security issue
      - Yes, blocked or delayed a launch/integration/deal
      - Yes, caused internal friction but no major incident
      - Not yet, but it is a concern
      - No
    - Log mapping: `severity_1_5`, `risk_reduced`

17. What did that friction cost you?
    - Type: checkboxes
    - Required: no
    - Options:
      - Engineering time
      - Security review time
      - Customer/support time
      - Delayed launch
      - Delayed integration
      - Lost deal or customer trust
      - Increased compliance/audit work
      - No measurable cost
      - Other
    - Log mapping: `time_or_money_cost`

18. If you had to rate the pain of proving agent identity, permissions, and current authorization today, how severe is it?
    - Type: linear scale 1-5
    - Required: yes
    - Labels:
      - 1: mild annoyance
      - 5: blocks deployment, deal, security, or trust
    - Log mapping: `severity_1_5`

19. How often does this pain show up?
    - Type: linear scale 1-5
    - Required: yes
    - Labels:
      - 1: yearly or rarely
      - 5: daily or every workflow
    - Log mapping: `frequency_1_5`

## Section 4: Disclosure and Trust

20. Have customers, partners, or other systems ever asked for more information than you wanted to disclose about an agent, automation, operator, or organization?
    - Type: multiple choice
    - Required: yes
    - Options:
      - Yes
      - No
      - Not sure
      - Has not come up yet

21. What did you share, redact, refuse, or work around?
    - Type: paragraph
    - Required: no
    - Log mapping: `raw_quote`, `trust_gap`

22. Which information should be easy to verify without exposing everything?
    - Type: checkboxes
    - Required: yes
    - Options:
      - Agent identity
      - Who controls or approved the agent
      - Current status: active, expired, suspended, revoked
      - Current purpose or mandate
      - Allowed tools or actions
      - Limits such as time, spend, data, or scope
      - Authorization level or permission tier
      - Organization or team affiliation
      - Audit trail or approval history
      - None of these
      - Other
    - Log mapping: `identity_gap`, `mandate_gap`, `capability_or_limit_gap`, `authorization_level_gap`, `new_value_unlocked`

23. What would make this kind of verification safer or more useful?
    - Type: paragraph
    - Required: no
    - Log mapping: `new_value_unlocked`, `risk_reduced`

## Section 5: Trust Ladder and Follow-up

24. On a scale of 1-10, how much do you trust your current setup for agent identity, permissions, and authorization?
    - Type: linear scale 1-10
    - Required: yes
    - Labels:
      - 1: very low trust
      - 10: high trust
    - Log mapping: `trust_gap`

25. What would move that trust score up by one point?
    - Type: paragraph
    - Required: yes
    - Log mapping: `new_value_unlocked`

26. Have you paid for, built, or allocated engineering time to solve identity, authorization, compliance, audit, or trust problems around agents or automations?
    - Type: multiple choice
    - Required: yes
    - Options:
      - Yes, paid for a tool/service
      - Yes, built an internal solution
      - Yes, allocated engineering or security time
      - No, but likely in the next 6 months
      - No
    - Log mapping: `time_or_money_cost`, `decision_impact`

27. What would make this urgent in the next quarter?
    - Type: paragraph
    - Required: no
    - Log mapping: `decision_impact`, `follow_up`

28. Would you be open to a 20-minute follow-up conversation?
    - Type: multiple choice
    - Required: yes
    - Options:
      - Yes
      - Maybe
      - No
    - Log mapping: `follow_up`

29. Optional: email or preferred contact method.
    - Type: short answer
    - Required: no
    - Log mapping: `follow_up`

## Scoring Notes

Use question 19 as `frequency_1_5`.

Use question 18 as `severity_1_5`.

Calculate `score = frequency_1_5 * severity_1_5`.

Recommended segment assignment:

- Mark as `Agent platform builders` if Q2 includes agent framework, agent platform, AI automation product, developer tooling, or internal enterprise automation.
- Mark as `Privacy/Web3 ecosystem builders` if Q2 includes wallet, credential, identity-related product, privacy-preserving application, protocol, infrastructure, or app platform.

High-priority follow-up signals:

- Q11 is "Yes, often" or "Yes, occasionally".
- Q16 is one of the first three options.
- Q18 is 4 or 5.
- Q19 is 4 or 5.
- Q26 is any "Yes" answer.
- Q28 is "Yes".
