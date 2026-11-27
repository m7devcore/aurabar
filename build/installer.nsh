!macro customInstall
  ; Clean up legacy AuraBar shortcuts, binary, and startup entries when upgrading to Glassy
  Delete "$DESKTOP\AuraBar.lnk"
  Delete "$SMPROGRAMS\AuraBar.lnk"
  RMDir /r "$SMPROGRAMS\AuraBar"
  Delete "$INSTDIR\AuraBar.exe"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "AuraBar"
  RMDir /r "$LOCALAPPDATA\AuraBar\native-cache"
  RMDir "$LOCALAPPDATA\AuraBar"
!macroend
