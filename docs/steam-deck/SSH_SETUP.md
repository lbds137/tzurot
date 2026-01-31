# Steam Deck SSH Setup for Git

This documents the SSH configuration needed for Git operations on Steam Deck, which has issues with ssh-askpass.

## One-Time Setup

### 1. Configure SSH

Add to `~/.ssh/config`:

```
Host github.com
  AddKeysToAgent yes
  IdentityFile ~/.ssh/id_ed25519
```

### 2. Set Up SSH Agent Persistence

Add to `~/.bashrc`:

```bash
# Auto-start SSH agent
if ! pgrep -x ssh-agent > /dev/null; then
    eval "$(ssh-agent -s)" > /dev/null
    SSH_ASKPASS="" ssh-add ~/.ssh/id_ed25519 2>/dev/null
fi
```

### 3. Test Connection

```bash
ssh -T git@github.com
```

Should see: "Hi username! You've successfully authenticated..."

## Troubleshooting

### SSH Key Not Loading

If the key isn't loading automatically:

```bash
# Start agent manually
eval "$(ssh-agent -s)"

# Add key without ssh-askpass
SSH_ASKPASS="" ssh-add ~/.ssh/id_ed25519
```

### Git Commands Failing

If git push/pull fails with SSH errors, try:

```bash
# Check if key is loaded
ssh-add -l

# If not, add it
SSH_ASKPASS_REQUIRE=never ssh-add ~/.ssh/id_ed25519
```

### Fallback: Direct SSH Command

If agent issues persist, set git to use SSH directly:

```bash
export GIT_SSH_COMMAND="ssh -o PasswordAuthentication=no -o PreferredAuthentications=publickey -i ~/.ssh/id_ed25519"
git push origin develop
```

## Adding SSH Key to GitHub

1. Go to https://github.com/settings/keys
2. Click "New SSH key"
3. Add your public key:

```bash
cat ~/.ssh/id_ed25519.pub
```
