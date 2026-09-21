import { Component, Input, Output, EventEmitter, signal, ViewChild, ElementRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { replaceMarkdownLinksWithSafeAnchors } from './markdown-link-sanitizer';
import { TranslatePipe, I18nService } from '../../core/services/i18n.service';

@Component({
  selector: 'ui-markdown-editor',
  standalone: true,
  imports: [
    TranslatePipe,CommonModule, FormsModule],
  template: `
    <div class="md-editor-container" [class.focused]="isFocused">
      <!-- Toolbar -->
      <div class="md-toolbar" role="toolbar" [attr.aria-label]="'ui.markdown_editor.formatirovanie_markdown' | t">
        <div class="toolbar-actions">
          <button type="button" class="tool-btn" (click)="insertFormat('bold')" [attr.aria-label]="'ui.markdown_editor.zhirnyy' | t" [title]="'ui.markdown_editor.zhirnyy_ctrl_b' | t">
            <span class="material-symbols-outlined" aria-hidden="true">format_bold</span>
          </button>
          <button type="button" class="tool-btn" (click)="insertFormat('italic')" [attr.aria-label]="'ui.markdown_editor.kursiv' | t" [title]="'ui.markdown_editor.kursiv_ctrl_i' | t">
            <span class="material-symbols-outlined" aria-hidden="true">format_italic</span>
          </button>
          <button type="button" class="tool-btn" (click)="insertFormat('strike')" [attr.aria-label]="'ui.markdown_editor.zacherknutyy' | t" [title]="'ui.markdown_editor.zacherknutyy.681ea7a' | t">
            <span class="material-symbols-outlined" aria-hidden="true">format_strikethrough</span>
          </button>
          <span class="tool-sep" role="separator" aria-orientation="vertical"></span>

          <button type="button" class="tool-btn" (click)="insertFormat('h2')" [attr.aria-label]="'ui.markdown_editor.zagolovok' | t" [title]="'ui.markdown_editor.zagolovok' | t">
            <span class="material-symbols-outlined" aria-hidden="true">title</span>
          </button>
          <button type="button" class="tool-btn" (click)="insertFormat('bullet-list')" [attr.aria-label]="'ui.markdown_editor.markirovannyy_spisok' | t" [title]="'ui.markdown_editor.markirovannyy_spisok' | t">
            <span class="material-symbols-outlined" aria-hidden="true">format_list_bulleted</span>
          </button>
          <button type="button" class="tool-btn" (click)="insertFormat('num-list')" [attr.aria-label]="'ui.markdown_editor.numerovannyy_spisok' | t" [title]="'ui.markdown_editor.numerovannyy_spisok' | t">
            <span class="material-symbols-outlined" aria-hidden="true">format_list_numbered</span>
          </button>
          <button type="button" class="tool-btn" (click)="insertFormat('task-list')" [attr.aria-label]="'ui.markdown_editor.chek_list_zadach' | t" [title]="'ui.markdown_editor.chek_list_zadach' | t">
            <span class="material-symbols-outlined" aria-hidden="true">checklist</span>
          </button>
          <span class="tool-sep" role="separator" aria-orientation="vertical"></span>

          <button type="button" class="tool-btn" (click)="insertFormat('code')" [attr.aria-label]="'settings.kod' | t" [title]="'settings.kod' | t">
            <span class="material-symbols-outlined" aria-hidden="true">code</span>
          </button>
          <button type="button" class="tool-btn" (click)="insertFormat('quote')" [attr.aria-label]="'ui.markdown_editor.citata' | t" [title]="'ui.markdown_editor.citata' | t">
            <span class="material-symbols-outlined" aria-hidden="true">format_quote</span>
          </button>
          <button type="button" class="tool-btn" (click)="insertFormat('link')" [attr.aria-label]="'ui.markdown_editor.ssylka' | t" [title]="'ui.markdown_editor.ssylka' | t">
            <span class="material-symbols-outlined" aria-hidden="true">link</span>
          </button>
          <button type="button" class="tool-btn" (click)="insertFormat('table')" [attr.aria-label]="'audit.tablica' | t" [title]="'audit.tablica' | t">
            <span class="material-symbols-outlined" aria-hidden="true">table</span>
          </button>
        </div>

        <!-- Mode Toggle Tabs -->
        <div class="mode-tabs" role="tablist" [attr.aria-label]="'ui.markdown_editor.rezhim_markdown' | t">
          <button
            type="button"
            class="mode-btn"
            role="tab"
            [id]="editTabId"
            [class.active]="mode === 'edit'"
            [attr.aria-selected]="mode === 'edit'"
            [attr.aria-controls]="editPanelId"
            (click)="mode = 'edit'"
          >
            <span class="material-symbols-outlined ico" aria-hidden="true">edit_note</span>
            <span>{{ 'ui.markdown_editor.redaktor' | t }}</span>
          </button>
          <button
            type="button"
            class="mode-btn"
            role="tab"
            [id]="previewTabId"
            [class.active]="mode === 'preview'"
            [attr.aria-selected]="mode === 'preview'"
            [attr.aria-controls]="previewPanelId"
            (click)="mode = 'preview'"
          >
            <span class="material-symbols-outlined ico" aria-hidden="true">visibility</span>
            <span>{{ 'ui.markdown_editor.predprosmotr' | t }}</span>
          </button>
        </div>
      </div>

      <!-- Editor Content -->
      <div class="md-body">
        <!-- Textarea Mode -->
        <div *ngIf="mode === 'edit'" class="editor-pane" role="tabpanel" [id]="editPanelId" [attr.aria-labelledby]="editTabId">
          <label class="sr-only" [for]="textareaId">{{ ariaLabel || ('ui.markdown_editor.tekst_v_formate_markdown' | t) }}</label>
          <textarea
            #textareaRef
            [id]="textareaId"
            class="md-textarea"
            [rows]="rows"
            [placeholder]="placeholder || ('ui.markdown_editor.napishite_tekst_zadachi_podderzhivaetsya_markdow' | t)"
            [ngModel]="value"
            (ngModelChange)="onTextChange($event)"
            (focus)="isFocused = true"
            (blur)="isFocused = false"
            (keydown)="handleKeydown($event)"
          ></textarea>
        </div>

        <!-- Preview Mode -->
        <div
          *ngIf="mode === 'preview'"
          class="md-preview-pane"
          role="tabpanel"
          [id]="previewPanelId"
          [attr.aria-labelledby]="previewTabId"
          [innerHTML]="renderMarkdown(value)"
        ></div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      width: 100%;
      min-width: 0;
      max-width: 100%;
    }

    .md-editor-container {
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      background-color: var(--bg-surface);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      width: 100%;
      min-width: 0;
      max-width: 100%;
      box-sizing: border-box;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    .md-editor-container.focused {
      border-color: var(--primary);
      box-shadow: 0 0 0 1px var(--primary);
    }

    .md-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      padding: 4px 8px;
      background-color: var(--bg-hover);
      border-bottom: 1px solid var(--border-color);
      flex-wrap: wrap;
    }

    .toolbar-actions {
      display: flex;
      align-items: center;
      gap: 2px;
      flex-wrap: wrap;
    }

    .tool-btn {
      border: none;
      background: transparent;
      color: var(--text-muted);
      border-radius: var(--radius-xs);
      width: 26px;
      height: 26px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      padding: 0;
      transition: all 0.1s ease;
    }
    .tool-btn:hover {
      background-color: var(--bg-surface);
      color: var(--text-main);
    }
    .tool-btn .material-symbols-outlined { font-size: 16px; }

    .tool-sep {
      width: 1px;
      height: 16px;
      background-color: var(--border-color);
      margin: 0 4px;
    }

    .mode-tabs {
      display: flex;
      background-color: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-xs);
      padding: 1px;
      gap: 2px;
    }
    .mode-btn {
      border: none;
      background: transparent;
      padding: 2px 8px;
      font-size: 11px;
      font-weight: 500;
      color: var(--text-muted);
      border-radius: 2px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: all 0.1s ease;
    }
    .mode-btn .ico { font-size: 14px; }
    .mode-btn.active {
      background-color: var(--primary);
      color: #fff;
    }

    .md-body {
      display: flex;
      flex-direction: column;
      position: relative;
    }

    .editor-pane {
      display: flex;
      flex-direction: column;
    }

    .md-textarea {
      width: 100%;
      border: none;
      outline: none;
      background: transparent;
      color: var(--text-main);
      padding: 8px 10px;
      font-family: inherit;
      font-size: 13px;
      line-height: 1.5;
      resize: vertical;
      min-height: 90px;
    }

    .md-preview-pane {
      padding: 10px 12px;
      min-height: 90px;
      max-height: 350px;
      overflow-y: auto;
      font-size: 13px;
      line-height: 1.6;
      color: var(--text-main);
      background-color: var(--bg-surface);
    }

    /* Markdown Rendered Typography */
    :host ::ng-deep .md-preview-pane h1,
    :host ::ng-deep .md-preview-pane h2,
    :host ::ng-deep .md-preview-pane h3,
    :host ::ng-deep .md-preview-pane h4 {
      margin-top: 8px;
      margin-bottom: 4px;
      font-weight: 600;
      color: var(--text-main);
    }
    :host ::ng-deep .md-preview-pane h1 { font-size: 16px; border-bottom: 1px solid var(--border-color); padding-bottom: 4px; }
    :host ::ng-deep .md-preview-pane h2 { font-size: 15px; }
    :host ::ng-deep .md-preview-pane h3 { font-size: 14px; }
    :host ::ng-deep .md-preview-pane p { margin: 4px 0; }
    :host ::ng-deep .md-preview-pane ul,
    :host ::ng-deep .md-preview-pane ol { padding-left: 20px; margin: 4px 0; }
    :host ::ng-deep .md-preview-pane li { margin: 2px 0; }
    :host ::ng-deep .md-preview-pane code {
      font-family: monospace;
      font-size: 12px;
      background-color: var(--bg-hover);
      padding: 2px 5px;
      border-radius: 3px;
      border: 1px solid var(--border-color);
    }
    :host ::ng-deep .md-preview-pane pre {
      background-color: var(--bg-hover);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      padding: 8px 10px;
      overflow-x: auto;
      margin: 6px 0;
    }
    :host ::ng-deep .md-preview-pane pre code {
      border: none;
      padding: 0;
      background: transparent;
    }
    :host ::ng-deep .md-preview-pane blockquote {
      margin: 6px 0;
      padding: 4px 10px;
      border-left: 3px solid var(--primary);
      background-color: var(--bg-hover);
      color: var(--text-muted);
      border-radius: 0 var(--radius-xs) var(--radius-xs) 0;
    }
    :host ::ng-deep .md-preview-pane table {
      width: 100%;
      border-collapse: collapse;
      margin: 8px 0;
      font-size: 12px;
    }
    :host ::ng-deep .md-preview-pane th,
    :host ::ng-deep .md-preview-pane td {
      border: 1px solid var(--border-color);
      padding: 6px 8px;
      text-align: left;
    }
    :host ::ng-deep .md-preview-pane th {
      background-color: var(--bg-hover);
      font-weight: 600;
    }
    :host ::ng-deep .md-preview-pane input[type="checkbox"] {
      margin-right: 6px;
      accent-color: var(--primary);
    }
    :host ::ng-deep .md-preview-pane a {
      color: var(--primary);
      text-decoration: underline;
    }
  `]
})
export class UiMarkdownEditorComponent {
  private readonly uiI18n = inject(I18nService);
  private static nextId = 0;

  @Input() value = '';
  @Input() placeholder = '';
  @Input() rows = 4;
  @Input() ariaLabel = '';
  @Output() valueChange = new EventEmitter<string>();

  @ViewChild('textareaRef') textareaRef?: ElementRef<HTMLTextAreaElement>;

  mode: 'edit' | 'preview' = 'edit';
  isFocused = false;
  private readonly componentId = UiMarkdownEditorComponent.nextId++;
  readonly textareaId = `ui-markdown-editor-${this.componentId}`;
  readonly editTabId = `ui-markdown-edit-tab-${this.componentId}`;
  readonly previewTabId = `ui-markdown-preview-tab-${this.componentId}`;
  readonly editPanelId = `ui-markdown-edit-panel-${this.componentId}`;
  readonly previewPanelId = `ui-markdown-preview-panel-${this.componentId}`;

  onTextChange(newVal: string) {
    this.value = newVal;
    this.valueChange.emit(newVal);
  }

  handleKeydown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key === 'b') {
      event.preventDefault();
      this.insertFormat('bold');
    } else if ((event.ctrlKey || event.metaKey) && event.key === 'i') {
      event.preventDefault();
      this.insertFormat('italic');
    }
  }

  insertFormat(type: string) {
    const el = this.textareaRef?.nativeElement;
    if (!el) {
      if (type === 'bold') this.onTextChange((this.value || '') + this.uiI18n.translate('ui.markdown_editor.zhirnyy_tekst'));
      return;
    }

    const start = el.selectionStart;
    const end = el.selectionEnd;
    const current = this.value || '';
    const selected = current.substring(start, end);

    let replacement = '';
    let cursorOffset = 0;

    switch (type) {
      case 'bold':
        replacement = `**${selected || this.uiI18n.translate('ui.markdown_editor.zhirnyy_tekst.4df48c2')}**`;
        cursorOffset = selected ? replacement.length : 2;
        break;
      case 'italic':
        replacement = `*${selected || this.uiI18n.translate('ui.markdown_editor.kursiv.64bef33')}*`;
        cursorOffset = selected ? replacement.length : 1;
        break;
      case 'strike':
        replacement = `~~${selected || this.uiI18n.translate('ui.markdown_editor.zacherknutyy_tekst')}~~`;
        cursorOffset = selected ? replacement.length : 2;
        break;
      case 'h2':
        replacement = `\n## ${selected || this.uiI18n.translate('ui.markdown_editor.zagolovok')}\n`;
        cursorOffset = replacement.length;
        break;
      case 'bullet-list':
        replacement = `\n- ${selected || this.uiI18n.translate('ui.markdown_editor.element_spiska')}\n- ${this.uiI18n.translate('ui.markdown_editor.vtoroy_element')}\n`;
        cursorOffset = replacement.length;
        break;
      case 'num-list':
        replacement = `\n1. ${selected || this.uiI18n.translate('ui.markdown_editor.pervyy_punkt')}\n2. ${this.uiI18n.translate('ui.markdown_editor.vtoroy_punkt')}\n`;
        cursorOffset = replacement.length;
        break;
      case 'task-list':
        replacement = `\n- [ ] ${selected || this.uiI18n.translate('ui.markdown_editor.podzadacha_ili_punkt_chek_lista')}\n- [x] ${this.uiI18n.translate('ui.markdown_editor.vypolnennyy_punkt')}\n`;
        cursorOffset = replacement.length;
        break;
      case 'code':
        if (selected.includes('\n')) {
          replacement = `\n\`\`\`\n${selected || 'code block'}\n\`\`\`\n`;
        } else {
          replacement = `\`${selected || 'code'}\``;
        }
        cursorOffset = replacement.length;
        break;
      case 'quote':
        replacement = `\n> ${selected || this.uiI18n.translate('ui.markdown_editor.citata_ili_vazhnoe_primechanie')}\n`;
        cursorOffset = replacement.length;
        break;
      case 'link':
        replacement = `[${selected || this.uiI18n.translate('ui.markdown_editor.tekst_ssylki')}](https://)`;
        cursorOffset = replacement.length - 1;
        break;
      case 'table':
        replacement = this.uiI18n.translate('ui.markdown_editor.parametr_znachenie_status_odobreno');
        cursorOffset = replacement.length;
        break;
      default:
        return;
    }

    const updated = current.substring(0, start) + replacement + current.substring(end);
    this.onTextChange(updated);

    setTimeout(() => {
      el.focus();
      el.setSelectionRange(start + cursorOffset, start + cursorOffset);
    }, 0);
  }

  renderMarkdown(text: string): string {
    if (!text || !text.trim()) {
      return `<span class="md-empty-preview">${this.escapeHtml(
        this.uiI18n.translate('ui.markdown_editor.empty_preview')
      )}</span>`;
    }

    let html = this.escapeHtml(text);

    // Code blocks ``` ... ```
    html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');

    // Inline code `...`
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Headers
    html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

    // Bold, Italic, Strike
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');

    // Blockquote
    html = html.replace(/^> (.*$)/gim, '<blockquote>$1</blockquote>');

    // Checklist: - [ ] and - [x]
    html = html.replace(/^- \[ \] (.*$)/gim, '<div><label><input type="checkbox" disabled /> $1</label></div>');
    html = html.replace(/^- \[x\] (.*$)/gim, '<div><label><input type="checkbox" checked disabled /> <del>$1</del></label></div>');

    // Unordered lists
    html = html.replace(/^\- (.*$)/gim, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');

    // Links [text](url)
    html = replaceMarkdownLinksWithSafeAnchors(html);

    // Linebreaks
    html = html.replace(/\n/g, '<br/>');

    return html;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
