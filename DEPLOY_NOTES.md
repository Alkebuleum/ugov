## uGov – How to ship updates to GitHub Pages
TL;DR (happy path)

Make your changes.

## Test locally:
npm ci
npm run dev
npm run build


## Commit & push to main:

git add -A
git commit -m "feat: updated contracts"
git push origin main


GitHub Actions auto-builds and deploys to Pages (custom domain: ugov.cc).


## --------------------------- (below not part of deploy)

## if amvault-connect is updated in npm package 
npm outdated amvault-connect
npm install amvault-connect@latest