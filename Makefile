
SHELL		= bash

#
# Runtime Setup
#


#
# Testing
#
test-unit:
	npx mocha --recursive ./tests/unit
test-unit-debug:
	LOG_LEVEL=silly npx mocha --recursive ./tests/unit
test-integration:
	npx mocha --recursive ./tests/integration
test-integration-debug:
	LOG_LEVEL=silly npx mocha --recursive ./tests/integration


#
# Project
#
package-lock.json:	package.json
	npm install
	touch $@
node_modules:		package-lock.json
	npm install
	touch $@


#
# Repository
#
clean-remove-chaff:
	@find . -name '*~' -exec rm {} \;
clean-files:		clean-remove-chaff
	git clean -nd
clean-files-force:	clean-remove-chaff
	git clean -fd
clean-files-all:	clean-remove-chaff
	git clean -ndx
clean-files-all-force:	clean-remove-chaff
	git clean -fdx
