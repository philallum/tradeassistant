# Convenience targets. `make check` mirrors the `npm run check` script:
# lint + type-check + tests. The authoritative verification of the
# confidence-shrinkage formula is the TypeScript property test
# (`src/confidence/`); there is no separate language toolchain.

.PHONY: install check lint typecheck test

install:
	npm install

check:
	npm run check

lint:
	npm run lint

typecheck:
	npm run typecheck

test:
	npm run test
