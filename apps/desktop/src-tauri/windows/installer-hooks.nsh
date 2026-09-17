!macro NSIS_HOOK_PREINSTALL
  IfFileExists "$EXEDIR\_internal\models\large-v3-turbo\model.bin" release_model_found
  MessageBox MB_ICONSTOP|MB_OK "WhisperSubtitle offline model pack is missing. Keep the setup executable beside _internal\models\large-v3-turbo and run setup again."
  Abort
release_model_found:
  IfFileExists "$EXEDIR\_internal\distribution\MicrosoftEdgeWebView2RuntimeInstallerX64.exe" release_webview_found
  MessageBox MB_ICONSTOP|MB_OK "WhisperSubtitle WebView2 offline installer is missing. Keep the complete _internal directory beside setup and run setup again."
  Abort
release_webview_found:
  ExecWait '"$EXEDIR\_internal\distribution\MicrosoftEdgeWebView2RuntimeInstallerX64.exe" /silent /install' $0
  IntCmp $0 0 release_webview_ready release_webview_failed release_webview_failed
release_webview_failed:
  MessageBox MB_ICONSTOP|MB_OK "Microsoft WebView2 Runtime installation failed with exit code $0."
  Abort
release_webview_ready:
!macroend

!macro NSIS_HOOK_POSTINSTALL
  CreateDirectory "$INSTDIR\_internal\models\large-v3-turbo"
  CopyFiles /SILENT "$EXEDIR\_internal\models\large-v3-turbo\*.*" "$INSTDIR\_internal\models\large-v3-turbo"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  RMDir /r "$INSTDIR\_internal\models\large-v3-turbo"
  RMDir "$INSTDIR\_internal\models"
!macroend
