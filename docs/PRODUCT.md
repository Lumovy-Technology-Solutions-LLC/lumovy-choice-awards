# Product overview

## What it is

**Lumovy Employee Choice Awards** is one reusable voting portal for every Lumovy HR contest. Each month HR can run a different contest (photography, writing, posters, video, documents) and employees pick a winner by voting for their top 3. Entries are shown **without the entrant's name**, so people vote for the work and not the person.

It replaces ad-hoc forms, spreadsheets and email threads with one place where a contest is set up, run, counted and announced.

## Who uses it

| Role | Who | What they can do |
| --- | --- | --- |
| **Employee (voter)** | Any active Lumovy employee | Sign in, see every contest, vote in contests open to their region, see results and their own vote |
| **HR admin** | HR team members given admin access | Everything an employee can, plus create contests, upload entries, manage people and regions, start and publish contests, send emails, see live tracking and download reports |

## What it does

- Runs any number of contests at the same time, each with its own entry type, deadline, regions and email wording.
- Shows entries anonymously and lets each employee rank their **1st, 2nd and 3rd** choice (the number of places is configurable, 3 by default).
- Counts points (3-2-1), applies tie-breaks, and publishes winners with names only when HR says so.
- Opens voting when HR clicks **Start contest** and closes it automatically at the end time (HR can also close early or extend while it is open).
- Emails everyone at the right moments: contest started, your vote is in, results declared, plus optional reminders and deadline extensions.
- Gives HR live tracking (turnout, who has not voted, HR-only leaderboard), Excel downloads and a full activity log.

## Contest lifecycle

```
Create -> Add entries -> Set schedule -> Voting (auto-closes) -> Check results -> Publish
  HR          HR              HR              employees               HR           HR
```

| Status | Meaning | Employees see |
| --- | --- | --- |
| Draft (optionally "Coming soon") | Being set up | Only if HR switched on "Coming soon": name and theme, no entries |
| Voting open | Live | Entries (participating regions), countdown, ballot |
| Voting closed | End time passed or HR closed it | "Results soon" |
| Winners announced | HR published | Winners, full results table, their own vote |

## Who can see and who can vote

- **Everyone** can *see* every contest that is open, coming soon or finished, and its published results.
- Only employees in the contest's **participating regions** can *vote* and receive its emails.
- A contest is **Regional** (one region), **Selected regions** (several) or **Global** (every region that is switched on).
- Every employee belongs to exactly one region. India is on at launch; other regions can be switched on later.

## Fairness rules

1. Voters never see who made an entry: not on screen, in file names, in file properties or in emails.
2. One vote per person per contest, tied to their sign-in. No guest voting.
3. Votes are final once submitted. Before that a voter can save unfinished picks.
4. Saved but unsubmitted picks do not count when voting closes.
5. No live scores for voters. Only HR sees the leaderboard while voting is open.
6. Hard close: nothing is accepted after the end time.
7. HR can see **who** voted but nobody, HR included, can see **who voted for which entry**.
8. Every admin action is logged with who and when.

## Scoring

| Pick | Points |
| --- | --- |
| 1st | 3 |
| 2nd | 2 |
| 3rd | 1 |

Most points wins. Tie: more 1st-place picks wins; still tied: more 2nd-place picks; still tied: the place is shared.

## Supported entry types

| Type | Accepted | Viewer |
| --- | --- | --- |
| Photo or poster | JPG, PNG, WebP, GIF | Large image view with HR-written alt text |
| Writing | Text pasted by HR | Reading view |
| Document | PDF, Word (.docx) | Built-in viewer with page count and zoom; labelled only "Entry NN.pdf" |
| Video | MP4, WebM, MOV | Built-in player |

One upload is one entry is one file. Hidden file details (author, camera, GPS, company) are removed on upload.

## Out of scope for version 1

- Public voting by people outside Lumovy.
- Prizes, payments or rewards handled inside the portal.
- Microsoft 365 single sign-on (login is email code or password; SSO can be added later).

## Success measures

- HR can launch a new contest in under 30 minutes without IT help.
- Every vote is fair, anonymous to the entry, and counted once.
- An employee can vote in about 2 minutes on a laptop or a phone.
