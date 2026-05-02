set BYTEMAN_JAR=C:/tools/byteman-download-4.0.20/lib/byteman.jar

set JAVA_TOOL_OPTIONS=-javaagent:"%BYTEMAN_JAR%"=script:"C:/path/to/munit-leak-detector.btm" -Xbootclasspath/a:"%BYTEMAN_JAR%" -Dorg.jboss.byteman.transform.all -Dcom.ning.http.client.AsyncHttpClientConfig.useProxyProperties=true

mvn clean test com.mulesoft.munit.tools:munit-maven-plugin:coverage-report "-Denv=dev"
