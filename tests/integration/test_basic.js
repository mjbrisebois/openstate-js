import logger				from '@whi/stdlog';

const log				= logger( import.meta.url.split('/').slice(-1)[0], {
    level: process.env.LOG_LEVEL || 'fatal',
});

import puppeteer			from 'puppeteer';
import { expect }			from 'chai';



function basic_tests () {
    let browser, page;

    before(async function () {
	browser				= await puppeteer.launch({
	    "headless": true,
	    "devtools": true,
	    "args": [
		"--disable-web-security",
	    ],
	});
	page				= await browser.newPage();

	page.on("console", async ( msg ) => {
	    let args			= await Promise.all( msg.args().map( async (jshandle) => await jshandle.jsonValue() ) );
	    if ( args.length === 0 )
		log.error("\x1b[90mPuppeteer console.log( \x1b[31m%s \x1b[90m)\x1b[0m", msg.text() );
	    else {
		log.silly("\x1b[90mPuppeteer console.log( \x1b[37m"+ args.shift() +" \x1b[90m)\x1b[0m", ...args );
	    }
	});
    });
    after(async function () {
	await browser.close();
    });

    it("should mount component", async function () {
	const url			= import.meta.url.split("/").slice(0,-1).join("/") + "/test.html";

	await page.goto( url );
	await page.evaluate(async () => {
	    console.log( await $root.$refs.component.test() );
	});
    });
}

describe("Integration", () => {
    describe("Component", basic_tests );
});
