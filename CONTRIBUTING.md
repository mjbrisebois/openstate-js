[back to README.md](README.md)

# Contributing

## Overview
This package is designed to utilize deductive reasoning in order to determine the metastate values
around a data context.

### Acceptance Criteria

- components must not manipulate metastate values directly
- event API (eg. store actions) dependencies must be mockable

![](https://drive.google.com/a/webheroes.ca/thumbnail?id=1xPu9glzvil2pGYR8QwJKG9V8I9OAulRn&sz=w1000)

### TODO

- [x] support `asyncValidation` and the synchronous `validation` in the same method
- [ ] implement cache
- [ ] explore and maybe implement `push` and/or `pull` behavior
- [x] make distinct methods for "get" vs "fetch" where "get" can be satisfied by an existing state value
  but "fetch" will always call a new read operation
  - [ ] fetch, recover, obtain, access, procure, fetch, acquire, grab, collect, produce, provide
- [ ] query string controls for path
  - [ ] instead of having an implicit path `something/all` we could use `something/*?filter=value`


## Development

### `logging()`
Turns on debugging logs.

```javascript
const { OpenState, logging } = require('openstate');

logging(); // show debug logs
```

### Environment

- Developed using Node.js `v18.7.0`

### Building
No build required.  Vanilla JS only.

### Testing

To run all tests with logging
```
make test-debug
```

- `make test-unit-debug` - **Unit tests only**
- `make test-integration-debug` - **Integration tests only**

> **NOTE:** remove `-debug` to run tests without logging

