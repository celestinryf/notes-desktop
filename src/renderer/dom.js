import NotesIcons from './icons.js';

export const $ = (sel) => document.querySelector(sel);
export const I = (name) => NotesIcons.svg(name);

// A button's words live in its .lbl span when it has one, so its icon and shortcut hint survive a relabel.
export function setLabel(btn, text) {
  const l = btn.querySelector('.lbl');
  if (l) l.textContent = text; else btn.textContent = text;
}
export function setIcon(btn, name) {
  if (btn.dataset.icon === name) return;
  btn.dataset.icon = name;
  NotesIcons.hydrate(btn.parentElement);
}
export function setPressed(btn, on) {
  btn.classList.toggle('is-on', !!on);
  btn.setAttribute('aria-pressed', String(!!on));
}

export const el = {
  app: $('#app'),
  sidebar: $('#sidebar'),
  newNoteBtn: $('#newNoteBtn'),
  navItems: Array.from(document.querySelectorAll('.nav-item[data-view]')),
  countAll: $('#countAll'), countPinned: $('#countPinned'), countTrash: $('#countTrash'), countReminders: $('#countReminders'),
  remindBtn: $('#remindBtn'), remindDialog: $('#remindDialog'), remindForm: $('#remindForm'), remindInput: $('#remindInput'), remindQuick: $('#remindQuick'),
  remindCurrent: $('#remindCurrent'), remindClearBtn: $('#remindClearBtn'), remindCancelBtn: $('#remindCancelBtn'),
  shareBtn: $('#shareBtn'), shareMenu: $('#shareMenu'), shareReveal: $('#shareReveal'),
  lockBtn: $('#lockBtn'), lockMenu: $('#lockMenu'), lockDialog: $('#lockDialog'), lockForm: $('#lockForm'), lockDialogTitle: $('#lockDialogTitle'), lockDialogHint: $('#lockDialogHint'),
  lockPassword: $('#lockPassword'), lockPassword2: $('#lockPassword2'), lockConfirmRow: $('#lockConfirmRow'), lockError: $('#lockError'), lockCancelBtn: $('#lockCancelBtn'), lockSubmitBtn: $('#lockSubmitBtn'),
  liveRow: $('#liveRow'), liveText: $('#liveText'), liveLinkBtn: $('#liveLinkBtn'), liveStopBtn: $('#liveStopBtn'), shareLiveHost: $('#shareLiveHost'), shareLiveStop: $('#shareLiveStop'),
  liveDialog: $('#liveDialog'), liveForm: $('#liveForm'), liveDialogTitle: $('#liveDialogTitle'), liveDialogHint: $('#liveDialogHint'), liveLinkLabel: $('#liveLinkLabel'), liveLinkInput: $('#liveLinkInput'),
  liveError: $('#liveError'), liveCopyBtn: $('#liveCopyBtn'), liveCancelBtn: $('#liveCancelBtn'), liveSubmitBtn: $('#liveSubmitBtn'),
  pageMenu: $('#pageMenu'), bookMenu: $('#bookMenu'), newBookBtn: $('#newBookBtn'),
  splitBtn: $('#splitBtn'), splitDialog: $('#splitDialog'), splitForm: $('#splitForm'), splitLead: $('#splitLead'), splitPages: $('#splitPages'), splitName: $('#splitName'), splitKeep: $('#splitKeep'), splitCancelBtn: $('#splitCancelBtn'),
  bookReader: $('#bookReader'), bookReaderTitle: $('#bookReaderTitle'), bookReaderToc: $('#bookReaderToc'), bookReaderBody: $('#bookReaderBody'), bookReaderScroll: $('#bookReaderScroll'),
  bookReaderPdfBtn: $('#bookReaderPdfBtn'), bookReaderPrintBtn: $('#bookReaderPrintBtn'), bookReaderCloseBtn: $('#bookReaderCloseBtn'),
  bookStrip: $('#bookStrip'), bookName: $('#bookName'), bookTabs: $('#bookTabs'), bookPrevBtn: $('#bookPrevBtn'), bookNextBtn: $('#bookNextBtn'), bookAddBtn: $('#bookAddBtn'),
  relatedPanel: $('#relatedPanel'), relatedOut: $('#relatedOut'), relatedIn: $('#relatedIn'), relatedTags: $('#relatedTags'), folderMenuBook: $('#folderMenuBook'),
  lockScreen: $('#lockScreen'), lockScreenPassword: $('#lockScreenPassword'), lockScreenBtn: $('#lockScreenBtn'), lockScreenError: $('#lockScreenError'),
  tagList: $('#tagList'),
  themeBtn: $('#themeBtn'), settingsBtn: $('#settingsBtn'),
  hotkeyHint: $('#hotkeyHint'), hotkeyHint2: $('#hotkeyHint2'),
  searchInput: $('#searchInput'), sortSelect: $('#sortSelect'),
  listTitle: $('#listTitle'), emptyTrashBtn: $('#emptyTrashBtn'),
  noteList: $('#noteList'), listEmpty: $('#listEmpty'),
  editorEmpty: $('#editorEmpty'), editor: $('#editor'),
  editorPane: $('#editorPane'), paneMain: $('#paneMain'), tabBar: $('#tabBar'), tabList: $('#tabList'), tabAddBtn: $('#tabAddBtn'), splitViewBtn: $('#splitViewBtn'), paneCloseBtn: $('#paneCloseBtn'), splitDivider: $('#splitDivider'),
  toggleSidebarBtn: $('#toggleSidebarBtn'), toggleListBtn: $('#toggleListBtn'), hideListBtn: $('#hideListBtn'), pinBtn: $('#pinBtn'), sourceBtn: $('#sourceBtn'),
  editorColumn: $('#editorColumn'), richEditor: $('#richEditor'),
  linkDialog: $('#linkDialog'), linkForm: $('#linkForm'), linkInput: $('#linkInput'), linkRemoveBtn: $('#linkRemoveBtn'), linkCancelBtn: $('#linkCancelBtn'),
  alignSeg: $('#alignSeg'), editorWidthInput: $('#editorWidthInput'), editorWidthValue: $('#editorWidthValue'), editorFullWidthInput: $('#editorFullWidthInput'),
  gitEnabledInput: $('#gitEnabledInput'), gitRemoteInput: $('#gitRemoteInput'), gitStatus: $('#gitStatus'), gitCommitBtn: $('#gitCommitBtn'), gitPushBtn: $('#gitPushBtn'),
  exportBtn: $('#exportBtn'), duplicateBtn: $('#duplicateBtn'), restoreBtn: $('#restoreBtn'),
  deleteBtn: $('#deleteBtn'), destroyBtn: $('#destroyBtn'),
  titleInput: $('#titleInput'), tagsInput: $('#tagsInput'), bodyInput: $('#bodyInput'), codeHost: $('#codeHost'), csvView: $('#csvView'), imageViewer: $('#imageViewer'), imageView: $('#imageView'),
  statusWords: $('#statusWords'), statusChars: $('#statusChars'), statusUpdated: $('#statusUpdated'), statusSaved: $('#statusSaved'), statusCode: $('#statusCode'),
  settingsDialog: $('#settingsDialog'), settingsForm: $('#settingsForm'),
  hotkeyInput: $('#hotkeyInput'), hotkeyError: $('#hotkeyError'), themeSelect: $('#themeSelect'),
  schemeGrid: $('#schemeGrid'), customModeNote: $('#customModeNote'), customBgInput: $('#customBgInput'), customTextInput: $('#customTextInput'), customAccentInput: $('#customAccentInput'), schemeResetBtn: $('#schemeResetBtn'),
  settingsDirtyNote: $('#settingsDirtyNote'), cancelSettingsBtn: $('#cancelSettingsBtn'), saveSettingsBtn: $('#saveSettingsBtn'),
  settingsSaveDialog: $('#settingsSaveDialog'), settingsSaveKeepBtn: $('#settingsSaveKeepBtn'), settingsSaveDiscardBtn: $('#settingsSaveDiscardBtn'), settingsSaveList: $('#settingsSaveList'),
  fontSizeInput: $('#fontSizeInput'), fontSizeValue: $('#fontSizeValue'),
  openAtLoginInput: $('#openAtLoginInput'), alwaysOnTopInput: $('#alwaysOnTopInput'),
  importBtn: $('#importBtn'), exportAllBtn: $('#exportAllBtn'), dataFolderBtn: $('#dataFolderBtn'),
  settingsInfo: $('#settingsInfo'),
  toast: $('#toast'),
  sidebarResizer: $('#sidebarResizer'), listResizer: $('#listResizer'),
  newFolderBtn: $('#newFolderBtn'), folderTree: $('#folderTree'), folderSelect: $('#folderSelect'), folderMenu: $('#folderMenu'),
  navAll: document.querySelector('.nav-item[data-view="all"]'),
  openFileBtn: $('#openFileBtn'), fileRow: $('#fileRow'), fileKind: $('#fileKind'), filePath: $('#filePath'),
  fileRevealBtn: $('#fileRevealBtn'), fileOpenBtn: $('#fileOpenBtn'), fileReloadBtn: $('#fileReloadBtn'), docxView: $('#docxView'), docxEditor: $('#docxEditor'), docxSaveBtn: $('#docxSaveBtn'),
  fileConvertBtn: $('#fileConvertBtn'), convertMenu: $('#convertMenu'),
  fileBanner: $('#fileBanner'), pdfEditor: $('#pdfEditor'), pdfSaveBtn: $('#pdfSaveBtn'), pdfUndoBtn: $('#pdfUndoBtn'), pdfRedoBtn: $('#pdfRedoBtn'), pdfZoomLabel: $('#pdfZoom'), pdfPages: $('#pdfPages'), pdfComments: $('#pdfComments'), pdfCommentsBtn: $('#pdfCommentsBtn'), pdfCommentsClose: $('#pdfCommentsClose'), agentFilesBtn: $('#agentFilesBtn'), agentFilesStatus: $('#agentFilesStatus'),
  signDialog: $('#signDialog'), signForm: $('#signForm'), signPad: $('#signPad'), signRemember: $('#signRemember'), signClearBtn: $('#signClearBtn'),
  signForgetBtn: $('#signForgetBtn'), signCancelBtn: $('#signCancelBtn'), signPlaceBtn: $('#signPlaceBtn'), signName: $('#signName'), signTypeBtn: $('#signTypeBtn'), signStatus: $('#signStatus'),
  readAloudBtn: $('#readAloudBtn'), dictateBtn: $('#dictateBtn'), ttsVoiceSelect: $('#ttsVoiceSelect'), ttsRateInput: $('#ttsRateInput'), ttsRateValue: $('#ttsRateValue'),
  vaultList: $('#vaultList'), vaultAddFolderBtn: $('#vaultAddFolderBtn'), vaultCloneBtn: $('#vaultCloneBtn'),
  vaultDialog: $('#vaultDialog'), vaultForm: $('#vaultForm'), vaultUrlInput: $('#vaultUrlInput'), vaultDestInput: $('#vaultDestInput'), vaultDestBtn: $('#vaultDestBtn'),
  vaultNameInput: $('#vaultNameInput'), vaultError: $('#vaultError'), vaultCancelBtn: $('#vaultCancelBtn'), vaultCloneSubmitBtn: $('#vaultCloneSubmitBtn'),
  folderMenuSync: $('#folderMenuSync'), folderMenuOpen: $('#folderMenuOpen'),
  stickyBtn: $('#stickyBtn'), botBtn: $('#botBtn'), printBtn: $('#printBtn'),
  findBar: $('#findBar'), findInput: $('#findInput'), findCount: $('#findCount'), findPrevBtn: $('#findPrevBtn'), findNextBtn: $('#findNextBtn'), findCloseBtn: $('#findCloseBtn'),
  findReplaceToggle: $('#findReplaceToggle'), replaceRow: $('#replaceRow'), replaceInput: $('#replaceInput'), replaceOneBtn: $('#replaceOneBtn'), replaceAllBtn: $('#replaceAllBtn'),
  attachBtn: $('#attachBtn'), recordBtn: $('#recordBtn'), historyBtn: $('#historyBtn'), linkNoteSelect: $('#linkNoteSelect'),
  historyDialog: $('#historyDialog'), historyList: $('#historyList'), historyPreview: $('#historyPreview'), historyStatus: $('#historyStatus'), historyCloseBtn: $('#historyCloseBtn'), historyRestoreBtn: $('#historyRestoreBtn'), botPanel: $('#botPanel'), botScope: $('#botScope'), botAllowEdits: $('#botAllowEdits'), botTerminalBtn: $('#botTerminalBtn'),
  botCloseBtn: $('#botCloseBtn'), botPrompt: $('#botPrompt'), botRunBtn: $('#botRunBtn'), botOutput: $('#botOutput'),
  moreBtn: $('#moreBtn'), moreMenu: $('#moreMenu'), paletteBtn: $('#paletteBtn'), palette: $('#palette'), paletteInput: $('#paletteInput'), paletteList: $('#paletteList'),
  inlineMenu: $('#inlineMenu'), wordcraftFrame: $('#wordcraftFrame'), gridcraftFrame: $('#gridcraftFrame'),
  sidebarTop: $('#sidebarTop'), barToggles: $('#barToggles'), sidebarEdge: $('#sidebarEdge'), noteTree: $('#noteTree'), noteActions: $('#noteActions'),
  tagsFold: $('#tagsFold'), listModeSeg: $('#listModeSeg'), sidebarFloatInput: $('#sidebarFloatInput'),
  activityBar: $('#activityBar'), emptyNewNoteBtn: $('#emptyNewNoteBtn'), settingsNav: $('#settingsNav'), settingsScroll: $('#settingsScroll'),
  settingsSearch: $('#settingsSearch'), settingsEmpty: $('#settingsEmpty'),
};
