# EducationalModules

Interactive graduate course modules for the Stanford LINQS group. Each folder is one course. Everything runs in the
browser from local files: no server, no install, no account.

| Folder | Course | Status |
|---|---|---|
| [`2026_QEC`](2026_QEC/) | Quantum error correction | Being prepared; no modules released yet |

## Using a course

1. Clone the repository: `git clone https://github.com/stanfordLINQS/EducationalModules.git`
2. Open `<course folder>/index.html` in Chrome.
3. Work through the modules. Your answers, self-ratings and review schedule are saved in your browser, not in the
   repository, so you never need to commit anything. They stay with that browser on that laptop.
4. To get new modules and fixes, run `git pull`. Your progress carries over.

## Questions and corrections

Each course has a shared Google Doc for questions and corrections; its course folder's README links to it. Say where
the issue is (module, section, equation) so it can be traced to the source.

## How this repository is maintained

The modules are written in a separate private repository and released here as built pages. A release replaces the
course folder, so edits made directly in this repository are overwritten; post corrections in the course's doc instead.
