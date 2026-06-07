.PHONY: build build-js build-standalone build-all install install-js install-standalone test

INSTALL_PATH := $(HOME)/.local/bin/senv

build: build-js

build-js:
	@bun run build:js

build-standalone:
	@bun run build:standalone

build-all: build-js build-standalone

test:
	bun test

install: install-js

install-js: build-js
	@$(MAKE) --no-print-directory _install SOURCE=dist/senv

install-standalone: build-standalone
	@$(MAKE) --no-print-directory _install SOURCE=dist/senv-standalone

_install:
	@if [ -f "$(INSTALL_PATH)" ]; then \
		if ! "$(INSTALL_PATH)" -V 2>&1 | grep -q "Secure ENV (senv)"; then \
			echo "Error: $(INSTALL_PATH) already exists but does not appear to be this senv application. Aborting to prevent name collision."; \
			exit 1; \
		fi; \
	fi
	@mkdir -p "$(HOME)/.local/bin"
	@cp $(SOURCE) "$(INSTALL_PATH)"
	@chmod +x "$(INSTALL_PATH)"
	@echo "senv has been successfully installed to $(INSTALL_PATH)"
