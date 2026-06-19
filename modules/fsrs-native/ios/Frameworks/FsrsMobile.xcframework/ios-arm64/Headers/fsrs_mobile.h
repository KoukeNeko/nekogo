#ifndef FSRS_MOBILE_H
#define FSRS_MOBILE_H

/* 工具鏈探針：固定回傳 42。 */
int fsrs_native_ping(void);

/* 用複習歷史訓練 FSRS 參數。
   輸入 JSON：{"items":[{"reviews":[{"rating":1-4,"deltaT":天}...]}...]}
   回傳 JSON 字串：{"ok":bool,"w":[...],"error":string|null}
   回傳指標須由 fsrs_free 釋放。 */
char *fsrs_optimize(const char *input_json);

/* 釋放 fsrs_optimize 回傳的字串。 */
void fsrs_free(char *ptr);

#endif /* FSRS_MOBILE_H */
