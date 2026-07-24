import { useEffect, useMemo } from "react";
import ReviewField from "./ReviewField.jsx";
import {
  STUDY_SUMMARY_CONFIG,
  findCategorySection,
  findOtherSection,
} from "./reviewSectionConfig.js";

const SAFE_FIELD_STATE = {
  value: "",
  autoValue: "",
  source: "default",
  manuallyEdited: false,
};

// Fields that are now editable directly on the main page. The drawer must
// not repeat them, so the "other" sections are trimmed down to only the
// long-form / infrequently-touched fields listed in the workbench spec.
const OTHER_DRAWER_FIELD_IDS = {
  睡眠: ["sleep.yesterday.lateReason", "sleep.yesterday.feeling", "sleep.yesterday.adjustment"],
  运动: ["exercise.today.bodyFeeling", "exercise.today.adjustment"],
  个护: ["selfcare.today.other"],
  "评分与总结": ["summary.special"],
  // Diary and state are fully inline on the main page now — nothing left for the drawer.
  日记: [],
  状态: [],
};

function DrawerFieldGrid({ fields, draft, onChange, onRestore, disabled }) {
  return (
    <div className="review-drawer-field-grid">
      {fields.map((field) => (
        <ReviewField
          key={field.id}
          field={field}
          state={draft?.fields?.[field.id] || SAFE_FIELD_STATE}
          onChange={onChange}
          onRestore={onRestore}
          disabled={disabled}
          dense={
            field.kind !== "text" ||
            field.id.endsWith(".title") ||
            field.id.endsWith(".tags")
          }
        />
      ))}
    </div>
  );
}

function StudyDrawerContent({ editor, draft, onChange, onRestore, disabled }) {
  const config = STUDY_SUMMARY_CONFIG.find((item) => item.id === editor.id);

  if (!config) {
    return <p className="review-drawer-empty">没有找到该学科的字段。</p>;
  }

  return (
    <div className="review-drawer-study">
      <section className="review-drawer-block">
        <header>
          <h3>今日推进</h3>
          <span>时长已在主页面直接填写，这里只补充推进说明</span>
        </header>

        <DrawerFieldGrid
          fields={config.progressFields.map((field) => ({ ...field, kind: "text" }))}
          draft={draft}
          onChange={onChange}
          onRestore={onRestore}
          disabled={disabled}
        />
      </section>

      <section className="review-drawer-block">
        <header>
          <h3>调整</h3>
        </header>

        <DrawerFieldGrid
          fields={[{ id: config.adjustmentId, label: `${config.title}调整`, kind: "text" }]}
          draft={draft}
          onChange={onChange}
          onRestore={onRestore}
          disabled={disabled}
        />
      </section>
    </div>
  );
}

function CategoryDrawerContent({
  editor,
  sections,
  draft,
  onChange,
  onRestore,
  disabled,
}) {
  const section = findCategorySection(sections, editor?.sourceTitle);

  if (!section) {
    return <p className="review-drawer-empty">没有找到该分类的字段。</p>;
  }

  const groupsWithLongFields = section.groups
    .map((group) => ({
      group,
      fields: (group.fields || []).filter((field) => field.kind === "text"),
    }))
    .filter((entry) => entry.fields.length > 0);

  if (!groupsWithLongFields.length) {
    return <p className="review-drawer-empty">这个分类没有需要补充的长文本字段——时长和选项都已经在主页面直接编辑。</p>;
  }

  return (
    <div className="review-drawer-groups">
      {groupsWithLongFields.map(({ group, fields }) => (
        <section
          className="review-drawer-block"
          key={`${group.title}-${group.temporaryId || "fixed"}`}
        >
          <header>
            <h3>{group.title}</h3>
          </header>

          <DrawerFieldGrid
            fields={fields}
            draft={draft}
            onChange={onChange}
            onRestore={onRestore}
            disabled={disabled}
          />
        </section>
      ))}
    </div>
  );
}

function OtherDrawerContent({ editor, otherSections, draft, onChange, onRestore, disabled }) {
  const section = findOtherSection(otherSections, editor?.sourceTitle);

  if (!section) {
    return <p className="review-drawer-empty">没有找到该分类的字段。</p>;
  }

  const keepIds = OTHER_DRAWER_FIELD_IDS[editor.sourceTitle];
  const fields = keepIds
    ? section.fields.filter((field) => keepIds.includes(field.id))
    : section.fields;

  if (!fields.length) {
    return <p className="review-drawer-empty">这个分类的字段都已经在主页面直接编辑。</p>;
  }

  return (
    <section className="review-drawer-block">
      <DrawerFieldGrid
        fields={fields}
        draft={draft}
        onChange={onChange}
        onRestore={onRestore}
        disabled={disabled}
      />
    </section>
  );
}

export default function ReviewEditDrawer({
  editor,
  sections,
  otherSections,
  draft,
  onChange,
  onRestore,
  onClose,
  disabled = false,
}) {
  const open = Boolean(editor) && Boolean(draft?.fields);

  useEffect(() => {
    if (!open) return undefined;

    const previousOverflow = document.body.style.overflow;

    document.body.style.overflow = "hidden";

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  const body = useMemo(() => {
    if (!open) return null;

    if (editor.kind === "study") {
      return (
        <StudyDrawerContent
          editor={editor}
          draft={draft}
          onChange={onChange}
          onRestore={onRestore}
          disabled={disabled}
        />
      );
    }

    if (editor.kind === "category") {
      return (
        <CategoryDrawerContent
          editor={editor}
          sections={sections}
          draft={draft}
          onChange={onChange}
          onRestore={onRestore}
          disabled={disabled}
        />
      );
    }

    return (
      <OtherDrawerContent
        editor={editor}
        otherSections={otherSections}
        draft={draft}
        onChange={onChange}
        onRestore={onRestore}
        disabled={disabled}
      />
    );
  }, [open, editor, sections, otherSections, draft, onChange, onRestore, disabled]);

  if (!open) return null;

  return (
    <div className="review-drawer-layer" role="presentation">
      <button
        className="review-drawer-backdrop"
        type="button"
        aria-label="关闭编辑面板"
        onClick={onClose}
      />

      <aside
        className="review-edit-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-drawer-title"
      >
        <header className="review-edit-drawer__header">
          <div>
            <span>详细记录</span>
            <h2 id="review-drawer-title">{editor.title}</h2>
          </div>

          <button type="button" aria-label="关闭" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="review-edit-drawer__body">{body}</div>

        <footer className="review-edit-drawer__footer">
          <span>内容会自动保存到当前草稿</span>

          <button className="primary-button" type="button" onClick={onClose}>
            完成
          </button>
        </footer>
      </aside>
    </div>
  );
}
