
# OpenState - Modular Web Components
A modular framework for shared state-management between web components.


[![](https://img.shields.io/github/issues-raw/mjbrisebois/openstate-js?style=flat-square)](https://github.com/mjbrisebois/openstate-js/issues)
[![](https://img.shields.io/github/issues-closed-raw/mjbrisebois/openstate-js?style=flat-square)](https://github.com/mjbrisebois/openstate-js/issues?q=is%3Aissue+is%3Aclosed)
[![](https://img.shields.io/github/issues-pr-raw/mjbrisebois/openstate-js?style=flat-square)](https://github.com/mjbrisebois/openstate-js/pulls)


## Overview

See [Demo](https://mjbrisebois.github.io/openstate-js/demo/)

### Design

![](https://drive.google.com/a/webheroes.ca/thumbnail?id=1cSY7EYXAYwL9FhkL895i6-_x70vKRKhv&sz=w1000)

#### Metastate Values

- `present`  - **True** if the data exists in `state`
- `current`  - **True** if `present` and not `expired`
- `changed`  - **True** if the initial `mutable` is different than the current `mutable`
- `readable` - *Implementation specific*
- `writable` - *Implementation specific*
- `reading`  - **True** if a read is currently in process
- `writing`  - **True** if a write is currently in process
- `cached`   - **True** if the value exists in cache storage
- `expired`  - *Implementation specific*
- `valid`    - **True** if `errors` is empty
- `invalid`  - Inverse of `valid`
- `failed`   - **True** if `write` was called and stopped because of `invalid`



### API Reference

See [docs/API.md](docs/API.md)

### Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md)
