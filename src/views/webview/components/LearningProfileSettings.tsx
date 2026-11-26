import { useState } from "react";
import {
  AVAILABLE_COMPARISON_MODES,
  COMPARISON_MODE_LABELS,
  LANGUAGE_FAMILY_IDS,
  MAX_KNOWN_LANGUAGES,
  PROFICIENCY_LABELS,
  languageLabel,
  type LanguageFamilyId,
  type LearningProfile,
  type ProficiencyLevel
} from "../../../shared/learningProfile";

export type LearningProfileDraft = Pick<LearningProfile, "knownLanguages" | "targetLanguage" | "comparisonMode">;

const LEVEL_OPTIONS: Array<{ value: ProficiencyLevel | ""; label: string }> = [
  { value: "", label: "習熟度: 指定なし" },
  { value: "basic", label: PROFICIENCY_LABELS.basic },
  { value: "working", label: PROFICIENCY_LABELS.working },
  { value: "advanced", label: PROFICIENCY_LABELS.advanced }
];

/**
 * 設定画面の「学習プロファイル」節。保存は設定画面の保存バーから行う（下書きは親が持つ）。
 */
export function LearningProfileSettings({
  value,
  onChange
}: {
  value: LearningProfileDraft;
  onChange: (next: LearningProfileDraft) => void;
}) {
  const registered = new Set(value.knownLanguages.map((item) => item.languageId));
  const addable = LANGUAGE_FAMILY_IDS.filter((id) => !registered.has(id));
  const [pendingLanguage, setPendingLanguage] = useState<LanguageFamilyId | "">("");
  const canAdd = (pendingLanguage: LanguageFamilyId | ""): pendingLanguage is LanguageFamilyId =>
    pendingLanguage !== "" && value.knownLanguages.length < MAX_KNOWN_LANGUAGES;
  const disabled = value.comparisonMode === "off";

  function update(partial: Partial<LearningProfileDraft>) {
    onChange({ ...value, ...partial });
  }

  function addLanguage() {
    if (!canAdd(pendingLanguage)) return;
    update({ knownLanguages: [...value.knownLanguages, { languageId: pendingLanguage }] });
    setPendingLanguage("");
  }

  return (
    <div className="learning-profile-settings">
      <div className="setting-item">
        <div className="setting-label setting-title">
          <span className="material-symbols-outlined setting-title-icon" aria-hidden="true">code</span>
          <span>経験のある言語</span>
        </div>
        <div className="setting-desc">
          登録した言語と比べた説明を、<code>/compare</code> や「PHPでいう〜」のような質問で求められます。習熟度は任意です
        </div>
        {value.knownLanguages.length === 0 ? (
          <div className="learning-profile-empty">まだ登録されていません</div>
        ) : (
          <ul className="learning-profile-languages">
            {value.knownLanguages.map((item, index) => (
              <li key={item.languageId} className="learning-profile-language">
                <span className="learning-profile-language-name">{languageLabel(item.languageId)}</span>
                <select
                  aria-label={`${languageLabel(item.languageId)}の習熟度`}
                  value={item.level ?? ""}
                  onChange={(event) => {
                    const level = event.target.value as ProficiencyLevel | "";
                    const next = value.knownLanguages.map((entry, entryIndex) =>
                      entryIndex === index ? (level ? { languageId: entry.languageId, level } : { languageId: entry.languageId }) : entry);
                    update({ knownLanguages: next });
                  }}
                >
                  {LEVEL_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                <button
                  type="button"
                  className="learning-profile-remove"
                  aria-label={`${languageLabel(item.languageId)}を削除`}
                  title="削除"
                  onClick={() => update({ knownLanguages: value.knownLanguages.filter((_, entryIndex) => entryIndex !== index) })}
                >
                  <span className="material-symbols-outlined" aria-hidden="true">close</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {value.knownLanguages.length < MAX_KNOWN_LANGUAGES && addable.length > 0 && (
          <div className="learning-profile-add">
            <select
              aria-label="追加する言語"
              value={pendingLanguage}
              onChange={(event) => setPendingLanguage(event.target.value as LanguageFamilyId | "")}
            >
              <option value="">言語を選択</option>
              {addable.map((id) => <option key={id} value={id}>{languageLabel(id)}</option>)}
            </select>
            <button type="button" className="btn-gray" disabled={!canAdd(pendingLanguage)} onClick={addLanguage}>追加</button>
          </div>
        )}
      </div>

      <div className="setting-item">
        <div className="setting-label setting-title">
          <span className="material-symbols-outlined setting-title-icon" aria-hidden="true">file_open</span>
          <span>学習中の言語</span>
        </div>
        <div className="setting-desc">比較で「学習中」として扱う言語です。学習中の言語と同じ言語は、比較には使いません</div>
        <div className="choice-options mode-options" role="group" aria-label="学習中の言語">
          <button
            type="button"
            className={`choice-option ${value.targetLanguage === "auto" ? "selected" : ""}`}
            aria-pressed={value.targetLanguage === "auto"}
            onClick={() => update({ targetLanguage: "auto" })}
          >
            編集中の言語
          </button>
          <button
            type="button"
            className={`choice-option ${value.targetLanguage !== "auto" ? "selected" : ""}`}
            aria-pressed={value.targetLanguage !== "auto"}
            onClick={() => update({ targetLanguage: value.targetLanguage === "auto" ? "typescript" : value.targetLanguage })}
          >
            固定する
          </button>
        </div>
        {value.targetLanguage !== "auto" && (
          <div className="learning-profile-add">
            <select
              aria-label="固定する学習中の言語"
              value={value.targetLanguage}
              onChange={(event) => update({ targetLanguage: event.target.value as LanguageFamilyId })}
            >
              {LANGUAGE_FAMILY_IDS.map((id) => <option key={id} value={id}>{languageLabel(id)}</option>)}
            </select>
          </div>
        )}
      </div>

      <div className="setting-item">
        <div className="setting-label setting-title">
          <span className="material-symbols-outlined setting-title-icon" aria-hidden="true">tune</span>
          <span>既知言語との比較</span>
        </div>
        <div className="setting-desc">
          「求めたときだけ」では、<code>/compare</code> と、言語を指定した比較の質問のときだけ使います。
          「控えめに提案」「自動で含める」は今後追加します
        </div>
        <div className="choice-options mode-options" role="group" aria-label="既知言語との比較">
          {AVAILABLE_COMPARISON_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              className={`choice-option ${value.comparisonMode === mode ? "selected" : ""}`}
              aria-pressed={value.comparisonMode === mode}
              onClick={() => update({ comparisonMode: mode })}
            >
              {COMPARISON_MODE_LABELS[mode]}
            </button>
          ))}
        </div>
        <div className="setting-desc learning-profile-privacy">
          {disabled
            ? "オフの間は、登録した言語をどの相談でもAIへ送りません。"
            : "プロファイルはこのPCのVS Codeにだけ保存され、同期しません。AIへ送るのは、比較を求めたときに使う言語1つの名前と習熟度だけです。"}
        </div>
      </div>
    </div>
  );
}
