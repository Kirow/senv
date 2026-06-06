.PHONY: build install test

build:
	bun run build

test:
	bun test

install: build
	@if [ -f "$(HOME)/.local/bin/senv" ]; then \
		if ! "$(HOME)/.local/bin/senv" --help 2>&1 | grep -q "Secure environment variables manager"; then \
			echo "Error: $(HOME)/.local/bin/senv already exists but does not appear to be this senv application. Aborting to prevent name collision."; \
			exit 1; \
		fi; \
	fi
	mkdir -p "$(HOME)/.local/bin"
	mv ./senv "$(HOME)/.local/bin/senv"
	@echo "senv has been successfully installed to $(HOME)/.local/bin/senv"
