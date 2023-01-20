# Basic Makefile

UUID = aztaskbar@aztaskbar.gitlab.com
BASE_MODULES = appIcon.js appIconIndicator.js appIconBadges.js enums.js extension.js LICENSE metadata.json panel.js README.md stylesheet.css theming.js unityLauncherAPI.js utils.js windowPreview.js
TRANSLATABLE_MODULES = prefs.js

TOLOCALIZE = $(TRANSLATABLE_MODULES)
EXTRA_DIRECTORIES = media
MSGSRC = $(wildcard po/*.po)
ifeq ($(strip $(DESTDIR)),)
	INSTALLBASE = $(HOME)/.local/share/gnome-shell/extensions
else
	INSTALLBASE = $(DESTDIR)/usr/share/gnome-shell/extensions
endif
INSTALLNAME = aztaskbar@aztaskbar.gitlab.com

# The command line passed variable VERSION is used to set the version string
# in the metadata and in the generated zip-file. If no VERSION is passed, the
# version is pulled from the latest git tag and the current commit SHA1 is 
# added to the metadata
ifdef VERSION
	FILESUFFIX = _v$(VERSION)
else
	COMMIT = $(shell git rev-parse HEAD)
	VERSION = 
	FILESUFFIX =
endif

all: extension

clean:
	rm -f ./schemas/gschemas.compiled

extension: ./schemas/gschemas.compiled $(MSGSRC:.po=.mo)

./schemas/gschemas.compiled: ./schemas/org.gnome.shell.extensions.aztaskbar.gschema.xml
	glib-compile-schemas ./schemas/

potfile: ./po/aztaskbar.pot

mergepo: potfile
	for l in $(MSGSRC); do \
		msgmerge -U $$l ./po/aztaskbar.pot; \
	done;

./po/aztaskbar.pot: $(TOLOCALIZE)
	mkdir -p po
	xgettext -k_ -kN_ --from-code utf-8 -o po/aztaskbar.pot --package-name "aztaskbar" $(TOLOCALIZE)

./po/%.mo: ./po/%.po
	msgfmt -c $< -o $@

install: install-local

install-local: _build
	rm -rf $(INSTALLBASE)/$(INSTALLNAME)
	mkdir -p $(INSTALLBASE)/$(INSTALLNAME)
	cp -r ./_build/* $(INSTALLBASE)/$(INSTALLNAME)/
	-rm -fR _build
	echo done

prefs enable disable reset info show:
	gnome-extensions $@ $(INSTALLNAME)

zip-file: _build
	cd _build ; \
	zip -qr "$(UUID)$(FILESUFFIX).zip" .
	mv _build/$(UUID)$(FILESUFFIX).zip ./
	-rm -fR _build

_build: all
	-rm -fR ./_build
	mkdir -p _build
	cp $(BASE_MODULES) $(TRANSLATABLE_MODULES) _build
	cp -r $(EXTRA_DIRECTORIES) _build
	mkdir -p _build/schemas
	cp schemas/*.xml _build/schemas/
	cp schemas/gschemas.compiled _build/schemas/
	mkdir -p _build/locale
	for l in $(MSGSRC:.po=.mo) ; do \
		lf=_build/locale/`basename $$l .mo`; \
		mkdir -p $$lf; \
		mkdir -p $$lf/LC_MESSAGES; \
		cp $$l $$lf/LC_MESSAGES/aztaskbar.mo; \
	done;
ifneq ($(COMMIT),)
	sed -i '/"version": .*,/a "commit": "$(COMMIT)",'  _build/metadata.json;
else ifneq ($(VERSION),)
	sed -i 's/"version": .*,/"version": $(VERSION),/'  _build/metadata.json;
endif
