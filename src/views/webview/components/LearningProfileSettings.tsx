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
import { SettingTitle } from "./SettingTitle";
import { SettingsSelect, type SettingsSelectOption } from "./SettingsSelect";

export type LearningProfileDraft = Pick<LearningProfile, "knownLanguages" | "comparisonMode" | "stuckDetectionEnabled">;

type LevelValue = ProficiencyLevel | "unspecified";

const LEVEL_OPTIONS: Array<SettingsSelectOption<LevelValue>> = [
  { value: "unspecified", label: "習熟度: 指定なし" },
  { value: "basic", label: PROFICIENCY_LABELS.basic },
  { value: "working", label: PROFICIENCY_LABELS.working },
  { value: "advanced", label: PROFICIENCY_LABELS.advanced }
];

/**
 * 設定画面の「学習プロファイル」節。保存は設定画面の保存バーから行う（下書きは親が持つ）。
 */
const MODE_DESCRIPTIONS: Record<LearningProfileDraft["comparisonMode"], string> = {
  off: "登録した言語を、どの相談でもAIへ送りません",
  onRequest: "/compare や言語を指定した比較の質問のときだけ使います",
  suggest: "加えて、比較が役立ちそうな回答の後に控えめな提案を出します（押したときだけAIを呼びます）",
  auto: "加えて、比較が役立ちそうなときに助言の中へ短い比較を含めます"
};

export function LearningProfileSettings({
  value,
  onChange,
  dismissedCount = 0,
  onResetDismissed
}: {
  value: LearningProfileDraft;
  onChange: (next: LearningProfileDraft) => void;
  /** 「今後出さない」を選んだ内容の件数（保存済みの値） */
  dismissedCount?: number;
  onResetDismissed?: () => void;
}) {
  const registered = new Set(value.knownLanguages.map((item) => item.languageId));
  const addableOptions = LANGUAGE_FAMILY_IDS
    .filter((languageId) => !registered.has(languageId))
    .map((languageId) => ({ value: languageId, label: languageLabel(languageId) }));
  const atLimit = value.knownLanguages.length >= MAX_KNOWN_LANGUAGES;

  function update(partial: Partial<LearningProfileDraft>) {
    onChange({ ...value, ...partial });
  }

  function setLevel(languageId: LanguageFamilyId, level: LevelValue) {
    update({
      knownLanguages: value.knownLanguages.map((item) =>
        item.languageId === languageId ? (level === "unspecified" ? { languageId } : { languageId, level }) : item)
    });
  }

  return (
    <>
      <div className="setting-item">
        <SettingTitle
          icon="code"
          help="経験のある言語と、任意で習熟度を登録します。/compare や「PHPでいう〜」のように比較を求めたとき、編集中のファイルの言語を、ここに登録した言語と比べて説明します。編集中の言語と同じ言語は比較に使いません。最大8件まで登録できます。"
        >
          経験のある言語
        </SettingTitle>
        <div className="setting-desc">比較の説明に使う言語です（{value.knownLanguages.length}/{MAX_KNOWN_LANGUAGES}）</div>
        {value.knownLanguages.length > 0 && (
          <div className="learning-language-list">
            {value.knownLanguages.map((item) => (
              <div key={item.languageId} className="learning-language-row">
                <span className="learning-language-name">{languageLabel(item.languageId)}</span>
                <SettingsSelect<LevelValue>
                  className="learning-language-level"
                  ariaLabel={`${languageLabel(item.languageId)}の習熟度`}
                  value={item.level ?? "unspecified"}
                  options={LEVEL_OPTIONS}
                  onChange={(level) => setLevel(item.languageId, level)}
                />
                <button
                  type="button"
                  className="learning-language-remove"
                  aria-label={`${languageLabel(item.languageId)}を削除`}
                  title="削除"
                  onClick={() => update({ knownLanguages: value.knownLanguages.filter((entry) => entry.languageId !== item.languageId) })}
                >
                  <span className="material-symbols-outlined" aria-hidden="true">close</span>
                </button>
              </div>
            ))}
          </div>
        )}
        {!atLimit && (
          <SettingsSelect<LanguageFamilyId>
            className="learning-language-add"
            ariaLabel="経験のある言語を追加"
            placeholder="＋ 言語を追加"
            options={addableOptions}
            onChange={(languageId) => update({ knownLanguages: [...value.knownLanguages, { languageId }] })}
          />
        )}
      </div>

      <div className="setting-item">
        <SettingTitle
          icon="tune"
          help="「求めたときだけ」は /compare と言語を指定した比較の質問のときだけ、「控えめに提案」はそれに加えて比較が役立ちそうな回答の後に提案を出し、「自動で含める」は助言の中に短い比較を含めます。判定はこのPCの中だけで行い、AIへ送るのは比較に使う言語1つの名前と習熟度だけです。「オフ」では、どの相談でも送りません。プロファイルはこのPCのVS Codeにだけ保存され、同期しません。"
        >
          既知言語との比較
        </SettingTitle>
        <div className="setting-desc">{MODE_DESCRIPTIONS[value.comparisonMode]}</div>
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
        {dismissedCount > 0 && onResetDismissed && (
          <div className="learning-dismissed">
            <span>「今後出さない」にした提案: {dismissedCount}件</span>
            <button type="button" className="learning-dismissed-reset" onClick={onResetDismissed}>すべて戻す</button>
          </div>
        )}
      </div>

      <div className="setting-item">
        <SettingTitle
          icon="timer"
          help="試験中の機能です。同じエラーが直らない・同じ所を書いては消す・同じ質問を繰り返す、といった様子から、つまずいている可能性を推定し、「出力」の NaviCom Diagnostics にだけ記録します。画面への表示やAIへの送信はしません。コードやエラーメッセージ、ファイル名は記録せず、推定の材料はメモリ上だけで扱います。"
        >
          つまずきの記録（試験中）
        </SettingTitle>
        <div className="setting-desc">つまずきの兆候を推定し、NaviCom Diagnostics にだけ記録します。表示やAIへの送信はしません</div>
        <div className="choice-options mode-options" role="group" aria-label="つまずきの記録">
          {[true, false].map((enabled) => (
            <button
              key={String(enabled)}
              type="button"
              className={`choice-option ${value.stuckDetectionEnabled === enabled ? "selected" : ""}`}
              aria-pressed={value.stuckDetectionEnabled === enabled}
              onClick={() => update({ stuckDetectionEnabled: enabled })}
            >
              {enabled ? "記録する" : "記録しない"}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
