'use strict';

import {
    StatusBarItem, StatusBarAlignment,
    Uri, CancellationToken,
    ViewColumn, ProviderResult,
    Disposable, TextDocumentContentProvider, QuickPickItem,
    commands, window, workspace
} from 'vscode';
import { RubicBoard, BoardClass } from "./rubicBoard";
import { BoardClassList } from "./boardClassList";
import * as path from 'path';
import * as util from 'util';
import * as Handlebars from 'handlebars';
import { readFileSync, watch, FSWatcher } from 'fs';

import * as nls from 'vscode-nls';
let localize = nls.config(process.env.VSCODE_NLS_CONFIG)(__filename);

const CMD_SHOW_CATALOG = "extension.rubic.showCatalog";
const CMD_SELECT_PORT  = "extension.rubic.selectPort";

export class BoardCatalog implements TextDocumentContentProvider {
    private _sbiBoard: StatusBarItem;
    private _sbiPort: StatusBarItem;
    private _boardId: string;
    private _boardPath: string;
    private _boardClass: BoardClass;
    private _firmwareId: string;
    private _configFile: string;
    private _watcher: FSWatcher;
    private _errorPopupBarrier: string = null;

    private static _instance: BoardCatalog;
    public static get instance(): BoardCatalog {
        return this._instance;
    }

    private _disposable: Disposable;
    public dispose(): void {
        this._disposable.dispose();
        this._watcher && this._watcher.close();
    }

    public constructor(private _extensionPath: string) {
        if (BoardCatalog._instance) {
            console.warn("Multiple BoardCatalog instances!");
            BoardCatalog._instance.dispose();
        }
        BoardCatalog._instance = this;

        let subscriptions: Disposable[] = [];

        // Register commands
        subscriptions.push(
            commands.registerCommand(CMD_SHOW_CATALOG, () => {
                this.showCatalog();
            })
        );
        subscriptions.push(
            commands.registerCommand(CMD_SELECT_PORT, (...args) => {
                this.selectPort(...args);
            })
        );

        subscriptions.push(
            workspace.registerTextDocumentContentProvider("rubic", this)
        );

        // Add status bar item
        this._sbiBoard = window.createStatusBarItem(StatusBarAlignment.Left);
        subscriptions.push(this._sbiBoard);
        this._sbiPort = window.createStatusBarItem(StatusBarAlignment.Left);
        subscriptions.push(this._sbiPort);

        this._sbiBoard.tooltip = localize("click-to-show-catalog", "Click here to show Rubic board catalog");
        this._sbiBoard.command = CMD_SHOW_CATALOG;
        this._sbiPort.tooltip = localize("click-to-select-port", "Click here to select port");
        this._sbiPort.command = CMD_SELECT_PORT;
        this._updateStatusBar();

        // Watch .rubic file to update status bar
        let {rootPath} = workspace;
        this._configFile = path.join(rootPath, ".vscode", "rubic.json");

        if (rootPath) {
            try {
                this._watcher = watch(
                    this._configFile, {}, this._configListener.bind(this)
                );
                this._configListener("change", null);
            } catch (error) {
                // Ignore errors
            }
        }

        this._disposable = Disposable.from(...subscriptions);
    }

    public showCatalog(): void {
        console.log("TODO: show catalog");
        let active = window.activeTextEditor;
        commands.executeCommand("vscode.previewHtml",
            Uri.parse("rubic://catalog"),
            (active ? active.viewColumn : ViewColumn.One),
            localize("catalog-title", "Rubic board catalog")
        )
    }

    public selectPort(...args): void {
        if (!this._boardClass) { return; }

        this._boardClass.list().then((ports) => {
            let list: QuickPickItem[] = [];
            ports.forEach((port) => {
                list.push({
                    label: port.path,
                    description: port.name
                });
            });
            if (list.length === 0) {
                window.showErrorMessage(
                    localize("board-not-connected", "No connected board")
                );
                return;
            }
            window.showQuickPick(list).then((selection) => {
                let index = list.indexOf(selection);
                if (index >= 0) {
                    this._boardPath = ports[index].path;
                    this._updateStatusBar();
                    console.warn("TODO: port change")
                    //this._testOnExtensionHost();
                    return;
                }
            })
        });
    }

    private _configListener(eventType: string, filename: string): void {
        if (eventType !== "change") { return; }

        let suffix = " : " + localize(
            "rubic-cfg-file",
            "Rubic configuration file ({0})",
            path.relative(workspace.rootPath, this._configFile)
        );
        let cfg;
        try {
            cfg = JSON.parse(readFileSync(this._configFile, "utf8"));
        } catch (error) {
            if (this._errorPopupBarrier === "invalid-rubic-cfg") { return; }
            this._errorPopupBarrier = "invalid-rubic-cfg";
            window.showErrorMessage(error.toString()).then(() => {
            window.showErrorMessage(localize(
                "invalid-rubic-cfg",
                "Incorrect JSON format",
            ) + suffix).then(() => { this._errorPopupBarrier = null; });});
            return;
        }

        if (typeof(cfg.boardId) !== "string") {
            if (this._errorPopupBarrier === "invalid-board-id") { return; }
            this._errorPopupBarrier = "invalid-board-id";
            window.showErrorMessage(localize(
                "invalid-board-id",
                "'boardId' key with string value is required"
            ) + suffix).then(() => { this._errorPopupBarrier = null; });
            return;
        }

        let boardClass: BoardClass = BoardClassList.getClassFromBoardId(cfg.boardId);
        if (!boardClass) {
            window.showErrorMessage(localize(
                "unknown-board-id",
                "Unknown board ID '{0}'",
                cfg.boardId
            ));
            return;
        }
        this._boardId = cfg.boardId;
        this._boardPath = cfg.boardPath;
        this._boardClass = boardClass;
        this._updateStatusBar();
    }

    private _updateStatusBar(): void {
        if (!this._boardClass) {
            this._sbiBoard.text = "$(circuit-board) " + localize("no-board", "No board selected");
            this._sbiBoard.show();
            this._sbiPort.hide();
            return;
        }
        this._sbiBoard.text = "$(circuit-board) " + this._boardClass.getName(this._boardId);
        this._sbiBoard.show();
        this._sbiPort.text = "$(triangle-right) " + (
            this._boardPath || localize("no-port", "No port selected")
        );
        this._sbiPort.show();
    }

    public provideTextDocumentContent(uri: Uri, token: CancellationToken): Promise<string> {
        if (uri.scheme !== "rubic" || uri.authority !== "catalog") {
            return Promise.reject(Error("invalid URI for rubic catalog"));
        }
        console.log("provider> " + util.format(uri));
        return Promise.resolve(
        ).then(() => {
            let template: Function = Handlebars.compile(
                readFileSync(path.join(this._extensionPath, "catalog.hbs"), "utf8")
            );
            let context: any = {
                currentPage: uri.query,
                extensionPath: this._extensionPath,
                cmd: encodeURI(`command:${CMD_SELECT_PORT}?${JSON.stringify(["hoo"])}`)
            };
            return template(context);
        });
    }

    private _testOnExtensionHost(): void {
        let board = new this._boardClass(this._boardId, this._boardPath);
        let wfile = "test.bin";
        let written: Buffer;
        Promise.resolve(
        ).then(() => {
            return board.connect();
        }).then(() => {/*
            return board.getInfo();
        }).then((info) => {
            window.showInformationMessage(util.format(info));
        }).then(() => {
            written = Buffer.alloc(123);
            for (let i = 0; i < written.byteLength; ++i) { written[i] = i & 255; }
            return board.writeFile(wfile, written);
        }).then(() => {
            return board.readFile(wfile);
        }).then((buf) => {
            if (buf.equals(written)) {
                return window.showInformationMessage(`verify OK! ${buf.length} bytes`);
            } else {
                return window.showErrorMessage(`verify NG! ${buf.length} bytes`);    
            }*/
            return board.runSketch("main.mrb");
        }).then(() => {
            return window.showInformationMessage("running...");
        }).then(() => {
            return board.disconnect();
        }).then(() => {
            window.showInformationMessage("test done");
            board.dispose();
        }).catch((err) => {
            window.showErrorMessage(err.toString());
            board.dispose();
        })
    }
}