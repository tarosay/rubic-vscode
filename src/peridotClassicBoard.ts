'use strict';

import { RubicBoard, BoardCandidate, BoardStdio, BoardInformation } from './rubicBoard';
import * as stream from 'stream';
import { Canarium } from 'canarium';
import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
let localize = nls.config(process.env.VSCODE_NLS_CONFIG)(__filename);

//*
Canarium.verbosity = 3;
//Canarium.BaseComm.verbosity = 3;
Canarium.RpcClient.verbosity = 3;
Canarium.RemoteFile.verbosity = 3;
//-*/

const J7ID_TO_RUBICID: any = {
    "J72A": "peridot_classic",
};

function buf2ab(buf: Buffer): ArrayBuffer {
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

function finallyPromise(f: any): [any, any] {
    let action = () => Promise.resolve(f()).catch(() => null);
    return [
        (result) => action().then(() => result),
        (reason) => action().then(() => Promise.reject(reason))
    ];
}

export class PeridotClassicBoard extends RubicBoard {
    private _storageRoot: string = "/mnt/internal";
    private _canarium: Canarium;
    private _stdio: BoardStdio;

    public constructor(private _path: string) {
        super();
        this._canarium = new Canarium();
        this._canarium.onClosed = this.onClosed.bind(this);
        this._stdio = null;
    }

    static list(): Promise<BoardCandidate[]> {
        return Canarium.enumerate().then((boards: any[]) => {
            return boards.map((board) => {
                let candidate: BoardCandidate = {
                    boardClass: this.name,
                    name: board.name,
                    path: board.path,
                };
                if (board.vendorId) { candidate.vendorId = parseInt(board.vendorId, 16); }
                if (board.productId) { candidate.productId = parseInt(board.productId, 16); }
                return candidate;
            });
        })
    }

    connect(): Promise<void> {
        return this._canarium.open(this._path);
    }

    disconnect(): Promise<void> {
        return this._canarium.close();
    }

    dispose(): void {
        this._canarium.close().catch(() => null);
    }

    getInfo(): Promise<BoardInformation> {
        return this._canarium.getinfo().then((info: {id: string, serialcode: string}) => {
            return {
                boardId: J7ID_TO_RUBICID[info.id] || "peridot",
                firmwareId: null,
                path: this._path,
                serialNumber: info.serialcode,
            };
        });
    }

    writeFile(filename: string, data: Buffer): Promise<void> {
        return Promise.resolve(
        ).then(() => {
            return this._canarium.openRemoteFile(
                this._getStoragePath(filename),
                {O_WRONLY: true, O_CREAT: true, O_TRUNC: true}
            );
        }).then((fd) => {
            return fd.write(buf2ab(data), true).then(
                (result) => fd.close().then(() => result),
                (reason) => fd.close().catch(() => null).then(() => Promise.reject(reason))
            );
        }).then((written) => {
            return;
        });
    }

    readFile(filename: string): Promise<Buffer> {
        return Promise.resolve(
        ).then(() => {
            return this._canarium.openRemoteFile(
                this._getStoragePath(filename),
                {O_RDONLY: true}
            );
        }).then((fd) => {
            let fileLength: number;
            return fd.lseek(0, {SEEK_END: true}).then((size) => {
                fileLength = size;
                if (fileLength == 0) { return; }
                return fd.lseek(0, {SEEK_SET: true});
            }).then((offset) => {
                if (fileLength == 0) { return Buffer.alloc(0); }
                return fd.read(fileLength, true).then((ab: ArrayBuffer) => {
                    return Buffer.from(ab);
                });
            }).then(
                (result) => fd.close().then(() => result),
                (reason) => fd.close().catch(() => null).then(() => Promise.reject(reason))
            );
        });
    }

    formatStorage(): Promise<void> {
        return Promise.resolve(
        ).then(() => {
            return this._canarium.openRemoteFile(
                "/sys/rubic/format",
                {O_WRONLY: true, O_TRUNC: true}
            );
        }).then((fd) => {
            return fd.close();
        }).then(() => {
            return;
        });
    }

    runSketch(filename: string): Promise<void> {
        return Promise.resolve(
        ).then(() => {
            return this._canarium.openRemoteFile(
                "/sys/rubic/run",
                {O_WRONLY: true, O_TRUNC: true}
            );
        }).then((fd) => {
            return fd.write(buf2ab(
                Buffer.from(this._getStoragePath(filename))
            ), true).then(
                (result) => fd.close().then(() => result),
                (reason) => fd.close().catch(() => null).then(() => Promise.reject(reason))
            );
        }).then((result) => {
            return;
        });
    }

    stopSketch(): Promise<void> {
        return Promise.resolve(
        ).then(() => {
            return this._canarium.openRemoteFile(
                "/sys/rubic/stop",
                {O_WRONLY: true, O_TRUNC: true}
            );
        }).then((fd) => {
            return fd.close();
        });
    }

    getStdio(options?: {stdin?: string, stdout?: string, stderr?:string}): Promise<BoardStdio> {
        if (this._stdio) {
            return Promise.resolve(this._stdio);
        }
        if (!options) {
            options = {}
        }
        let stdin, stdout, stderr;
        return Promise.resolve(
        ).then(() => {
            return this._canarium.openRemoteFile(
                options.stdin ? options.stdin : "/dev/stdin",
                {O_WRONLY: true}
            ).then(
                (file) => { stdin = new CanariumWritableStream(file); },
                (error) => { console.error(error); }
            )
        }).then(() => {
            return this._canarium.openRemoteFile(
                options.stdout ? options.stdout : "/dev/stdout",
                {O_RDONLY: true}
            ).then(
                (file) => { stdout = new CanariumReadableStream(file); }
            )
        }).then(() => {
            return this._canarium.openRemoteFile(
                options.stderr ? options.stderr : "/dev/stderr",
                {O_RDONLY: true}
            ).then(
                (file) => { stderr = new CanariumReadableStream(file); },
                (error) => { console.error(error); }
            )
        }).then(() => {
            this._stdio = <BoardStdio>{stdin, stdout, stderr};
            return this._stdio;
        })  // return Promise.resolve().then()...
    }

    private onClosed() {
        this._stdio = null;
    }

    private _getStoragePath(filename: string): string {
        return this._storageRoot + "/" + filename;
    }
}

class CanariumWritableStream extends stream.Writable {
    constructor(private _file: any) {
        super({decodeStrings: true});
    }

    protected _write(chunk: Buffer, encoding: string, callback: Function) {
        this._file.write(buf2ab(chunk), true).then(
            () => { callback(); },
            (error) => { callback(error); }
        );
    }
}

class CanariumReadableStream extends stream.Readable {
    constructor(private _file: any) {
        super({encoding: null});
    }

    protected _read(size: number) {
        this._file.read(size).then((arrayBuffer: ArrayBuffer) => {
            this.push(Buffer.from(arrayBuffer))
        })
    }
}