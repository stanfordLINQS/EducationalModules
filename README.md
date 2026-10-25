# EducationalModules

Interactive graduate course modules for the Stanford LINQS group. Each folder is one course. Everything runs in the
browser from local files: no server, no install, no account.

| Folder | Course |
|---|---|
| [`2026_QEC`](2026_QEC/) | Quantum error correction: from parity checks to fault-tolerant machines |

Each course folder's README lists the modules in its current release.

## Using a course

1. Clone the repository: `git clone https://github.com/stanfordLINQS/EducationalModules.git`
2. Open `<course folder>/index.html` in Chrome.
3. Work through the modules. Your answers, self-ratings and review schedule are saved in your browser, not in the
   repository, so you never need to commit anything. They stay with that browser on that laptop.
4. To get new modules and fixes, run `git pull`. Your progress carries over.

## Questions and corrections

Each course has one shared document for questions and corrections that everyone edits in the browser; the course
pages and the course folder's README link to it. Each section and equation has a **Copy ref** control that
copies its location and the release, for example `[§2.4 eq 2.7] · Release: 2026_QEC-r4`; start each entry with
it.

## How this repository is maintained

The modules are written in a separate private repository and released here as built pages. A release replaces the
course folder, so edits made directly in this repository are overwritten; post corrections in the course's doc instead.
