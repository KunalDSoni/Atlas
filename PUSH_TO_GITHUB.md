# How to Push Atlas to GitHub

## Step 1: Create the repo on GitHub
Go to https://github.com/new and create a new repo called `atlas` (empty, no README).

## Step 2: Open Terminal in the jira-clone folder and run:

```bash
cd jira-clone
git init
git add .
git commit -m "Initial commit: Atlas project management tool"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/atlas.git
git push -u origin main
```

Replace `YOUR_USERNAME` with your GitHub username.

## That's it!
Your code is now on GitHub at `https://github.com/YOUR_USERNAME/atlas`
