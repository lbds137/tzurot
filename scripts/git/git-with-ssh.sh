#!/bin/bash

# Git with SSH helper - works around ssh-askpass issues on Steam Deck
# Usage: ./scripts/git-with-ssh.sh <git command>
# Example: ./scripts/git-with-ssh.sh push origin develop

# Start ssh-agent if not running
if [ -z "$SSH_AUTH_SOCK" ]; then
    eval "$(ssh-agent -s)" > /dev/null 2>&1
fi

# Check if key is loaded
ssh-add -l > /dev/null 2>&1
if [ $? -ne 0 ]; then
    echo "🔐 Adding SSH key (you'll need to enter your passphrase)..."
    SSH_ASKPASS_REQUIRE=never ssh-add ~/.ssh/id_ed25519
    if [ $? -ne 0 ]; then
        echo "❌ Failed to add SSH key. Trying without agent..."
        # Fall back to using ssh directly without agent
        export GIT_SSH_COMMAND="ssh -o PasswordAuthentication=no -o PreferredAuthentications=publickey -i ~/.ssh/id_ed25519"
    fi
fi

# Run the git command
echo "🚀 Running: git $@"
git "$@"