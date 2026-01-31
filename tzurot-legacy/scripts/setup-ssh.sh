#!/bin/bash

# SSH Setup Script for Steam Deck
# This handles SSH agent setup without ssh-askpass

echo "🔐 Setting up SSH for Git..."

# Check if SSH agent is running
if ! pgrep -x ssh-agent > /dev/null; then
    echo "Starting SSH agent..."
    eval "$(ssh-agent -s)"
fi

# Add SSH key without ssh-askpass
echo "Adding SSH key..."
SSH_ASKPASS="" ssh-add ~/.ssh/id_ed25519 2>/dev/null || {
    echo "⚠️  Could not add SSH key automatically."
    echo "If your key has a passphrase, you'll need to enter it when pushing/pulling."
}

# Test GitHub connection
echo "Testing GitHub connection..."
ssh -T git@github.com 2>&1 | grep -q "successfully authenticated" && {
    echo "✅ GitHub SSH authentication successful!"
} || {
    echo "❌ GitHub SSH authentication failed."
    echo ""
    echo "Please make sure you've added your SSH key to GitHub:"
    echo "1. Go to https://github.com/settings/keys"
    echo "2. Click 'New SSH key'"
    echo "3. Add this key:"
    echo ""
    cat ~/.ssh/id_ed25519.pub
    echo ""
}

# Add to bashrc for persistence
if ! grep -q "ssh-agent" ~/.bashrc; then
    echo ""
    echo "Adding SSH agent to ~/.bashrc for persistence..."
    cat >> ~/.bashrc << 'EOF'

# Auto-start SSH agent
if ! pgrep -x ssh-agent > /dev/null; then
    eval "$(ssh-agent -s)" > /dev/null
    SSH_ASKPASS="" ssh-add ~/.ssh/id_ed25519 2>/dev/null
fi
EOF
    echo "✅ Added to ~/.bashrc"
fi

echo ""
echo "🎉 SSH setup complete!"
echo ""
echo "Next steps:"
echo "1. Make sure your SSH key is added to GitHub"
echo "2. Try: git fetch origin"
echo "3. If it works, you're all set!"