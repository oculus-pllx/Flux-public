# 📤 Uploading NUT Monitor to GitHub

## Step 1: Create a GitHub Repository

1. Go to [GitHub](https://github.com) and log in
2. Click **"New"** button (top left) or go to [github.com/new](https://github.com/new)
3. Fill in:
   - **Repository name**: `nut-monitor` (or your preferred name)
   - **Description**: "Network UPS Tools monitoring dashboard"
   - **Visibility**: Choose `Public` (if sharing) or `Private` (if personal)
   - **Initialize**: Leave unchecked (we have local code)
4. Click **"Create repository"**

---

## Step 2: Initialize Git Locally

```bash
# Navigate to project directory
cd nut-monitor

# Initialize git (if not already initialized)
git init

# Add all files
git add .

# Create initial commit
git commit -m "Initial commit: Complete NUT monitoring application

- Full backend API with NUT integration
- React frontend with dark theme dashboard
- SQLite database with Sequelize ORM
- Background polling and alert service
- Multi-user with role-based access control
- Docker deployment setup
- Complete documentation"
```

---

## Step 3: Add Remote and Push

```bash
# Replace USERNAME with your GitHub username
git remote add origin https://github.com/USERNAME/nut-monitor.git

# Verify remote was added
git remote -v
# Should show:
# origin  https://github.com/USERNAME/nut-monitor.git (fetch)
# origin  https://github.com/USERNAME/nut-monitor.git (push)

# Push code to GitHub
git branch -M main
git push -u origin main
```

**If using SSH instead:**
```bash
git remote add origin git@github.com:USERNAME/nut-monitor.git
git push -u origin main
```

---

## Step 4: Verify on GitHub

1. Go to `https://github.com/USERNAME/nut-monitor`
2. You should see all your files and folders
3. Check that `.gitignore` is working (no `node_modules/` or `backend/data/` folders visible)

---

## Alternative: Using GitHub CLI (Faster)

If you have [GitHub CLI](https://cli.github.com/) installed:

```bash
# Authenticate (one time)
gh auth login

# Create repository and push automatically
gh repo create nut-monitor --source=. --remote=origin --push
```

---

## Adding Files Going Forward

```bash
# Check what's changed
git status

# Add new files
git add <filename>

# Or add everything
git add .

# Commit
git commit -m "Describe your changes here"

# Push to GitHub
git push
```

---

## Useful GitHub Setup Commands

### Add a .gitignore (already done, but for reference)
```bash
# Make sure node_modules and data are ignored
cat .gitignore
# Should contain:
# node_modules/
# backend/data/
# .env (don't commit secrets!)
```

### Create a Release

```bash
# Tag a version
git tag -a v1.0.0 -m "First release"

# Push tags
git push origin v1.0.0

# On GitHub: Go to Releases → Draft new release → Select tag
```

### Add Collaborators

1. Go to your repo → Settings → Collaborators
2. Click "Add people"
3. Search for GitHub username
4. Set permissions (pull, triage, push, admin)

---

## Setting Up Secrets (for CI/CD later)

If you want to add automated deployment:

1. Go to repo → Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Add secrets like:
   - `JWT_SECRET`: Your JWT secret
   - `DOCKER_USERNAME`: Docker Hub username
   - `DOCKER_PASSWORD`: Docker Hub access token

---

## GitHub Best Practices

### Branch Strategy
```bash
# For new features, create feature branch
git checkout -b feature/alert-types

# Make changes, commit, push
git add .
git commit -m "Add new alert trigger types"
git push -u origin feature/alert-types

# On GitHub, create Pull Request
# After review, merge to main
```

### Commit Messages (Good Format)
```
# Short summary (50 chars or less)
Add email alert support for critical triggers

# Blank line
# Detailed explanation (if needed)
- Added SMTP configuration to backend
- Added email recipient configuration to alert triggers
- Implemented email service with Nodemailer
- Added testing for SMTP delivery

# Reference issues
Fixes #123
Related to #456
```

---

## CI/CD with GitHub Actions (Optional)

Create `.github/workflows/test.yml`:

```yaml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v3
    
    - uses: actions/setup-node@v3
      with:
        node-version: '18'
    
    - name: Install backend
      run: cd backend && npm install
    
    - name: Install frontend
      run: cd frontend && npm install
    
    - name: Build frontend
      run: cd frontend && npm run build
```

Then push this file:
```bash
git add .github/workflows/test.yml
git commit -m "Add GitHub Actions CI workflow"
git push
```

---

## Automated Deployment (Optional)

If you want Docker Hub auto-build:

1. Connect GitHub to Docker Hub account
2. Create automated build
3. Every push to main builds Docker image

---

## Securing Secrets

**NEVER commit**:
- `.env` file (add to .gitignore)
- Private keys
- API keys
- Database passwords

**Instead use**:
- Environment variables
- GitHub Secrets
- .env.example (with placeholder values)

Check your .gitignore:
```bash
cat .gitignore | grep -E "\.env|node_modules|data"
# Should show these are ignored
```

---

## After Pushing: Add to README

Update `README.md` with GitHub info:

```markdown
## Installation

### From GitHub
```bash
git clone https://github.com/USERNAME/nut-monitor.git
cd nut-monitor
cp .env.example .env
docker-compose up -d
```

### Star & Fork
If you like this project, please consider starring ⭐ and forking 🍴!
```

---

## Common Git Commands Reference

```bash
# See history
git log --oneline

# See differences
git diff

# Undo last commit (keep changes)
git reset --soft HEAD~1

# Undo last commit (discard changes)
git reset --hard HEAD~1

# See all branches
git branch -a

# Switch branch
git checkout branch-name

# Create new branch
git checkout -b new-branch-name

# Delete branch
git branch -d branch-name

# Push specific branch
git push origin branch-name

# Pull latest changes
git pull
```

---

## Verifying Your Repository

After pushing, verify:

```bash
# Clone your repo (simulates someone else getting it)
cd /tmp
git clone https://github.com/USERNAME/nut-monitor.git
cd nut-monitor

# Check structure
ls -la
# Should show all files

# Check .gitignore worked
ls backend/
# Should NOT have node_modules or data folder

# Start fresh
cp .env.example .env
docker-compose up -d
```

---

## Creating Releases

```bash
# Tag version
git tag -a v1.0.0 -m "Version 1.0.0 - Initial Release"
git push origin v1.0.0

# On GitHub: Releases → New Release → Select tag → Create Release
# Add release notes describing changes
```

---

## GitHub Pages (Optional - for documentation)

If you want hosted documentation:

1. Go to repo Settings → Pages
2. Select `main` branch
3. Docs will be at `USERNAME.github.io/nut-monitor`

---

## Summary: Full Process

```bash
# 1. Create repo on GitHub.com

# 2. Initialize locally
cd nut-monitor
git init
git add .
git commit -m "Initial commit: Complete NUT monitoring app"

# 3. Connect and push
git remote add origin https://github.com/USERNAME/nut-monitor.git
git branch -M main
git push -u origin main

# 4. Verify at https://github.com/USERNAME/nut-monitor

# 5. Going forward
git add .
git commit -m "Your changes"
git push
```

---

## Troubleshooting

### "Repository already exists"
```bash
git remote remove origin
git remote add origin https://github.com/USERNAME/nut-monitor.git
```

### "Authentication failed"
- Make sure you're using correct username
- Try SSH instead of HTTPS
- Generate personal access token if using HTTPS

### "Permission denied (publickey)"
- Generate SSH key: `ssh-keygen -t ed25519`
- Add to GitHub Settings → SSH keys

### "Pushing large files"
```bash
# Check file sizes
find . -size +50M -type f

# Git LFS for large files (optional)
git lfs install
git lfs track "*.db"
git add .gitattributes
```

---

## Nice-to-Have Additions

### Add Badge to README
```markdown
[![GitHub stars](https://img.shields.io/github/stars/USERNAME/nut-monitor?style=social)](https://github.com/USERNAME/nut-monitor)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
```

### Create LICENSE File

Create `LICENSE` with MIT license text from [opensource.org](https://opensource.org/licenses/MIT)

### Add CONTRIBUTING.md

Guide for contributors:
```markdown
# Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes
4. Push to your fork
5. Create a Pull Request
```

---

## You're All Set! 🚀

Your NUT Monitor project is now on GitHub!

**What to do next**:
- Share the link with your team
- Document setup in README
- Enable Discussions for support
- Set up GitHub Issues for bugs
- Consider GitHub Pages for docs

**Repository**: `https://github.com/USERNAME/nut-monitor`

---

## Quick Reference Card

```
Create Repo:        Go to github.com/new
Add Remote:         git remote add origin URL
First Push:         git push -u origin main
Regular Push:       git push
Create Release:     git tag v1.0.0 && git push origin v1.0.0
Check Status:       git status
View History:       git log --oneline
Create Branch:      git checkout -b feature-name
```

Happy coding! 🔋
