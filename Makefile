UUID = rounded-window-corners-ultimate@coffeebowl
SRCDIR = extension
ZIP = $(UUID).shell-extension.zip

EXTRA_SOURCES = \
	effect \
	manager \
	patch \
	utils

.PHONY: pack install test smoke pot clean

pack:
	gnome-extensions pack $(SRCDIR) \
		--force \
		--out-dir=. \
		--podir=../po \
		$(addprefix --extra-source=,$(EXTRA_SOURCES))

install: pack
	gnome-extensions install --force $(ZIP)

test:
	@for t in tests/*.test.js; do \
		[ -e "$$t" ] || continue; \
		gjs -m "$$t" || exit 1; \
	done

smoke:
	tests/run-smoke.sh wayland
	tests/run-smoke.sh x11
	RWC_SMOKE_SCRIPT=$(CURDIR)/tests/coverage-smoke.js tests/run-smoke.sh x11
	RWC_SMOKE_MONITOR=1920x1080 RWC_SMOKE_SCRIPT=$(CURDIR)/tests/border-smoke.js \
		tests/run-smoke.sh wayland
	RWC_SMOKE_MONITOR=1920x1080 RWC_SMOKE_SCRIPT=$(CURDIR)/tests/border-smoke.js \
		tests/run-smoke.sh x11
	RWC_SMOKE_MONITOR=1920x1080 RWC_SMOKE_SCRIPT=$(CURDIR)/tests/adw-smoke.js \
		tests/run-smoke.sh wayland
	RWC_SMOKE_SCRIPT=$(CURDIR)/tests/prefs-smoke.js tests/run-smoke.sh wayland

pot:
	xgettext --from-code=UTF-8 \
		--output=po/$(UUID).pot \
		--language=JavaScript \
		--add-comments=Translators: \
		$$(find $(SRCDIR) -name '*.js' | sort)
	for file in po/*.po; do \
		msgmerge -q -U --backup=off $$file po/$(UUID).pot; \
		msgattrib --no-obsolete --output-file=$$file $$file; \
	done

clean:
	rm -f $(ZIP)
