import logger				from '@whi/stdlog';

const log				= logger( import.meta.url.split('/').slice(-1)[0], {
    level: process.env.LOG_LEVEL || 'fatal',
});

import Vuex				from 'vuex';
import { expect }			from 'chai';

import { Client }			from '../../src/mock_client.js';
import init_store			from '../../src/store.js';

const client				= new Client();
const store				= init_store( Vuex, client );


function basic_tests () {

    it("should use state", async function () {
	expect( store.state.count	).to.equal( 0 );
    });

    it("should use getters", async function () {
	expect( store.getters.count	).to.equal( 0 );
    });

    it("should run commit", async function () {
	store.commit("increment");
	expect( store.state.count	).to.equal( 1 );
    });

    it("should run action", async function () {
	await store.dispatch("increment");
	expect( store.state.count	).to.equal( 2 );
    });

    it("should call service API", async function () {
	const id			= "some_hash";
	await store.dispatch("get_something", id );

	const value			= store.state.entities[id];
	expect( value			).to.equal( true );
    });

    it("should trigger metastate 'present'");
    it("should trigger metastate 'reading'");
    it("should trigger metastate 'writing'");
    it("should trigger metastate 'cached'");
    it("should trigger metastate 'expired'");
    it("should trigger metastate 'valid'");
    it("should trigger metastate 'invalid'");
}

describe("Unit", () => {
    describe("Store", basic_tests );
});
