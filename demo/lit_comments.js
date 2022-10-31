const { LitElement, nothing,
	html, css, unsafeCSS,
	repeat }		= lit;

console.log("Loading comments openstate");


const BOOTSTRAP_CSS			= await (await fetch("https://cdn.jsdelivr.net/npm/bootstrap@5.2.2/dist/css/bootstrap.min.css")).text();
const BI_CSS				= await (await fetch("https://cdn.jsdelivr.net/npm/bootstrap-icons@1.9.1/font/bootstrap-icons.css")).text();

// console.log( BOOTSTRAP_CSS );

export class UserPost extends LitElement {
    static get properties () {
	return {
	    "postid": {
		"attribute": "post-id",
		"type": String,
		"reflect": true,
	    },
	    "editing": {
		"type": Boolean,
		"reflect": true,
	    },
	    "onsave": {
		"type": Function,
	    },
	};
    }

    static styles = [
	css`${unsafeCSS(BOOTSTRAP_CSS)}`,
	css`${unsafeCSS(BI_CSS)}`,
    ];

    get metastate () {
	return this.$openstate.metastate[ this.datapath ];
    }

    get state () {
	return this.$openstate.state[ this.datapath ];
    }

    get mutable () {
	return this.$openstate.mutable[ this.datapath ];
    }

    get rejections () {
	return this.$openstate.rejections[ this.datapath ];
    }

    get datapath () {
	return this.postid ? `post/${this.postid}` : this.$openstate.DEADEND;
    }

    constructor () {
	super();
	console.log("constructor", this );

	this.editing		= false;
    }

    get postid () {
	return this._postid;
    }
    set postid ( id ) {
	console.log("set postid:", this.postid, id );
	this._postid		= id;

	this.$openstate.on( this.datapath, (type, ...args) => {
	    console.log("OpenState event '%s'", type, this, ...args );

	    if ( type === "state" )
		this.requestUpdate();
	    if ( type === "metastate" )
		this.requestUpdate();
	    if ( type === "mutable" )
		this.requestUpdate();
	});
    }

    onInput (evt) {
	this.mutable.message	= evt.target.value;
    }

    showEditor () {
	this.editing		= true;
    }

    hideEditor () {
	this.editing		= false;
    }

    resetMutable () {
	this.$openstate.resetMutable( this.datapath );
    }

    async savePost () {
	await this.$openstate.write( this.datapath );

	this.editing		= false;
	this.postid		= this.state.id;

	console.log("onsave", this.onsave );
	this.onsave && this.onsave();

	console.log("Trigger all/posts read");
	this.$openstate.read("all/posts");
    }

    formRejections () {
	return html`\
<div class="invalid-feedback">
    ${this.rejections.map( msg => html`${msg}` )}
</div>
`;
    }

    card_html ( content ) {
	return html`\
<div class="card my-3">
    <div class="card-body">
        ${content}
    </div>
</div>
`;
    }

    form_html () {
	const spinner			= html`<span class="spinner-border spinner-border-sm"></span>`;
	const delete_btn		= html`<a class="btn btn-outline-danger" @click=${this.deleteSelf}>Delete</a>`;
	const cancel_btn		= html`<a class="btn btn-outline-secondary me-3" @click=${this.hideEditor}>Cancel</a>`;
	const reset_btn			= html`<a class="btn btn-outline-warning me-3" @click=${this.resetMutable}>Reset</a>`;
	const save_btn			= html`\
<a class="btn btn-primary ${this.metastate.changed ? '' : 'disabled'}" @click=${this.savePost}>
    ${ this.metastate.writing ? spinner : nothing }
    ${ this.metastate.present ? 'Update' : 'Create' }
</a>
`;

	return html`\
<div class="row ${this.metastate.failed ? 'was-validated' : ''}">
    <div class="mb-3">
        <label class="form-label">Message</label>
        <input class="form-control" .value=${this.mutable.message} @input=${this.onInput} required ?disabled=${this.metastate.writing} />
        ${this.formRejections()}
    </div>
    <div class="col d-flex">
        ${ this.metastate.present ? [ cancel_btn, this.metastate.changed ? reset_btn : nothing ] : nothing }
    </div>
    <div class="col-auto text-end">
        ${save_btn}
    </div>
</div>
`;
    }

    edit_btn_html () {
	return html`<a class="btn" @click=${this.showEditor}><i class="bi-pencil"></i></a>`;
    }

    main_html () {
	const loading_html		= html`\
<div class="d-flex justify-content-center">
    <div class="spinner-border"></div>
</div>
`;
	const message_html		= html`\
<blockquote class="blockquote mb-0">
    <div class="float-end">${ this.metastate.writable ? this.edit_btn_html() : nothing }</div>
    <p>${this.state.message}</p>
    <footer class="blockquote-footer">Anonymous in <cite>Browser</cite></footer>
</blockquote>
`;
	return (this.metastate.writing || this.metastate.reading) ? loading_html : message_html;
    }

    html_404 () {
	return html`\
<div class="alert alert-warning mb-0">
    404 not found
</div>
`;
    }

    render () {
	return this.card_html(
	    this.editing
		? this.form_html()
		: this.metastate.present ? this.main_html() : this.html_404()
	);
    }
}
