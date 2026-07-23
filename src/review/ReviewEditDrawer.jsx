import { useEffect, useMemo } from "react";
import ReviewField from "./ReviewField.jsx";
import {
  STUDY_SUMMARY_CONFIG,
  findCategorySection,
  findOtherSection,
  formatMinutes,
  numericValue,
} from "./reviewSectionConfig.js";

function DrawerFieldGrid({
  fields,
  draft,
  onChange,
  onRestore,
  disabled,
}) {
  return (
    <div className="review-drawer-field-grid">
      {fields.map((field) => (
        <ReviewField
          key={field.id}
          field={field}
          state={draft.fields[field.id]}
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

function StudyDrawerContent({
  editor,
  draft,
  onChange,
  onRestore,
  disabled,
}) {
  const config = STUDY_SUMMARY_CONFIG.find(
    (item) => item.id === editor.id
  );

  if (!config) return null;

  const durationFields = [
    {
      id: config.totalId,
      label: "总时长",
      kind: "duration",
    },
    ...config.durationFields.map((field) => ({
      ...field,
      kind: "duration",
    })),
  ].filter(
    (field, index, list) =>
      list.findIndex((item) => item.id === field.id) === index
  );

  return (
    <div className="review-drawer-study">
      <section className="review-drawer-block">
        <header>
          <h3>时长</h3>
          <span>
            当前总计 {formatMinutes(
              numericValue(draft, config.totalId)
            )}
          </span>
        </header>

        <DrawerFieldGrid
          fields={durationFields}
          draft={draft}
          onChange={onChange}
          onRestore={onRestore}
          disabled={disabled}
        />
      </section>

      <section className="review-drawer-block">
        <header>
          <h3>今日推进</h3>
          <span>按细分学习项填写</span>
        </header>

        <DrawerFieldGrid
          fields={config.progressFields.map((field) => ({
            ...field,
            kind: "text",
          }))}
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
          fields={[
            {
              id: config.adjustmentId,
              label: `${config.title}调整`,
              kind: "text",
            },
          ]}
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
  onAddProject,
  onRemoveProject,
  disabled,
}) {
  const section = findCategorySection(
    sections,
    editor.sourceTitle
  );

  if (!section) {
    return (
      <p className="review-drawer-empty">
        没有找到该分类的字段。
      </p>
    );
  }

  return (
    <div className="review-drawer-groups">
      {section.title === "项目" && (
        <button
          className="review-drawer-add-project"
          type="button"
          disabled={disabled}
          onClick={onAddProject}
        >
          + 新增当天项目
        </button>
      )}

      {section.groups.map((group) => (
        <section
          className="review-drawer-block"
          key={`${group.title}-${group.temporaryId || "fixed"}`}
        >
          <header>
            <h3>{group.title}</h3>

            {group.temporaryId && (
              <button
                type="button"
                disabled={disabled}
                onClick={() =>
                  onRemoveProject(group.temporaryId)
                }
              >
                删除当天项目
              </button>
            )}
          </header>

          <DrawerFieldGrid
            fields={group.fields}
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

function OtherDrawerContent({
  editor,
  otherSections,
  draft,
  onChange,
  onRestore,
  disabled,
}) {
  const section = findOtherSection(
    otherSections,
    editor.sourceTitle
  );

  if (!section) {
    return (
      <p className="review-drawer-empty">
        没有找到该分类的字段。
      </p>
    );
  }

  return (
    <section className="review-drawer-block">
      <DrawerFieldGrid
        fields={section.fields}
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
  onAddProject,
  onRemoveProject,
  disabled = false,
}) {
  const open = Boolean(editor);

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
    if (!editor) return null;

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
          onAddProject={onAddProject}
          onRemoveProject={onRemoveProject}
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
  }, [
    editor,
    sections,
    otherSections,
    draft,
    onChange,
    onRestore,
    onAddProject,
    onRemoveProject,
    disabled,
  ]);

  if (!open) return null;

  return (
    <div
      className="review-drawer-layer"
      role="presentation"
    >
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
            <span>编辑当日复盘</span>
            <h2 id="review-drawer-title">
              {editor.title}
            </h2>
          </div>

          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="review-edit-drawer__body">
          {body}
        </div>

        <footer className="review-edit-drawer__footer">
          <span>内容会自动保存到当前草稿</span>

          <button
            className="primary-button"
            type="button"
            onClick={onClose}
          >
            完成
          </button>
        </footer>
      </aside>
    </div>
  );
}
