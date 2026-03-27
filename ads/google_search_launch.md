# Google Search Launch

Use this campaign first. It is built around the live landing page at `https://claudeaiblog.com/join.html` and should point to the email-first signup flow.

## Campaign settings

- Campaign name: `Claude Updates | Search | CA+GA | Launch`
- Goal: `Website traffic` for launch day, then move to `Leads` after conversion tracking is live
- Campaign type: `Search`
- Networks: `Google Search` only
- Locations: `California` and `Georgia`
- Languages: `English`
- Bidding: `Maximize clicks`
- Max CPC bid limit: `$2.50`
- Daily budget: `$25`
- Ad rotation: `Optimize`
- Schedule: run all day for the first 72 hours, then trim by performance

## Final URL

- Primary landing page:
  - `https://claudeaiblog.com/join.html?utm_source=google&utm_medium=cpc&utm_campaign=claude_updates_search`

## Tracking

- Set `GA_MEASUREMENT_ID` or `GTM_CONTAINER_ID` for analytics.
- Set `GOOGLE_ADS_CONVERSION_LABEL` to the Google Ads lead conversion label so the thank-you page can fire the right conversion event.
- Keep the final URL stable and vary only `utm_*` values and ad-specific content IDs.

## Negative keywords

Add these at the campaign level:

- `free`
- `download`
- `login`
- `app`
- `api`
- `pricing`
- `jobs`
- `job`
- `careers`
- `salary`
- `stock`
- `support`
- `customer service`
- `phone number`

## Ad group 1

- Name: `Claude Updates`
- Final URL:
  - `https://claudeaiblog.com/join.html?utm_source=google&utm_medium=cpc&utm_campaign=claude_updates_search&utm_content=claude_updates`

### Keywords

- `[claude ai updates]`
- `"claude ai updates"`
- `[claude ai news]`
- `"claude ai news"`
- `[claude release notes]`
- `"claude release notes"`
- `[anthropic claude news]`
- `"anthropic claude updates"`
- `[claude model updates]`
- `"claude model updates"`

### Responsive search ad headlines

- `Weekly Claude Email Brief`
- `Track Claude Launch Notes`
- `Claude Code Release Notes`
- `Claude Model Updates`
- `For Builders Using Claude`
- `Readable Claude Coverage`
- `Get Claude Updates Fast`
- `Skip Generic AI Hype`
- `Source-Backed Claude Notes`
- `Join The Claude Brief`
- `Weekly Claude Updates`

### Descriptions

- `Get a weekly Claude email brief with launches, workflow changes, and release notes worth tracking.`
- `Built for builders, teams, and heavy Claude users who want signal instead of AI noise.`
- `Read source-backed Claude release notes and product changes in one faster summary.`
- `Join the email list for Claude model news, Claude Code notes, and workflow breakdowns.`

## Ad group 2

- Name: `Claude Features`
- Final URL:
  - `https://claudeaiblog.com/join.html?utm_source=google&utm_medium=cpc&utm_campaign=claude_updates_search&utm_content=claude_features`

### Keywords

- `[claude code]`
- `"claude code"`
- `[claude projects]`
- `"claude projects"`
- `[claude artifacts]`
- `"claude artifacts"`
- `"claude workflows"`
- `"claude code guide"`
- `"claude projects guide"`
- `"claude artifacts guide"`

### Responsive search ad headlines

- `Claude Code And Workflows`
- `Projects And Artifacts`
- `Claude Feature Breakdowns`
- `Track Claude Releases`
- `Opus Sonnet Haiku Notes`
- `Weekly Workflow Notes`
- `Understand Claude Faster`
- `Independent Claude Guides`
- `For Builders And Teams`
- `Track Product Changes`
- `Email Claude Updates`

### Descriptions

- `Follow Claude Code, Projects, Artifacts, and product changes that matter in one weekly brief.`
- `Independent Claude guides for writing, coding, research, and analysis workflows.`
- `Get readable updates instead of digging through every release post yourself.`
- `Join the email list for source-backed Claude feature notes and workflow breakdowns.`

## Callouts

- `Weekly email brief`
- `For builders and teams`
- `Source-backed updates`
- `Claude Code coverage`
- `No spam`

## Sitelinks

- `Get Claude Updates`
  - `https://claudeaiblog.com/join.html?utm_source=google&utm_medium=cpc&utm_campaign=claude_updates_search&utm_content=sitelink_join`
- `Claude AI Homepage`
  - `https://claudeaiblog.com/?utm_source=google&utm_medium=cpc&utm_campaign=claude_updates_search&utm_content=sitelink_home`
- `Join Form`
  - `https://claudeaiblog.com/join.html?utm_source=google&utm_medium=cpc&utm_campaign=claude_updates_search&utm_content=sitelink_form#join-form`
- `Privacy Policy`
  - `https://claudeaiblog.com/privacy.html?utm_source=google&utm_medium=cpc&utm_campaign=claude_updates_search&utm_content=sitelink_privacy`

## Launch notes

- Start with exact and phrase match only.
- Do not turn on Display expansion.
- Keep ad copy clearly independent and not official Anthropic branding.
- Check search terms after the first 24 hours and add negatives aggressively.
- If conversion tracking is not live yet, judge day-one performance by clicks, CTR, and actual form submissions.
- After the page is live, validate one test lead in Google Ads using the conversion label env var before increasing budget.
- Keep Google Search Partners off during learning until the `Submit lead form` conversion action is active and reporting.
- Do not switch bidding strategy or make repeated budget changes while the campaign is still learning.
